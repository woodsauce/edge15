const $ = id => document.getElementById(id);
const fmtUsd = n => Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '--';
const fmtC = n => Number.isFinite(n) ? `${Math.round(n)}¢` : '--';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const tanh = Math.tanh;

const STORAGE = {
  history: 'edge15_history_v25_930',
  logs: 'edge15_logs_v25_930',
  snapshots: 'edge15_auto_snapshots_v25_930'
};

const state = {
  paused: false,
  interval: null,
  latest: null,
  decision: null,
  history: JSON.parse(localStorage.getItem(STORAGE.history) || '[]'),
  logs: JSON.parse(localStorage.getItem(STORAGE.logs) || '[]'),
  snapshots: JSON.parse(localStorage.getItem(STORAGE.snapshots) || '[]'),
  diagnostics: [],
  lastCandlesFetch: 0,
  cachedCandles: []
};

const profiles = {
  '9:30 Predictor': { score: 18, edge: 2.5, risk: 66, safety: 4, label: 'Default test profile' },
  '9:30 Aggressive': { score: 13, edge: 1.0, risk: 78, safety: 2.5, label: 'More calls, more noise' },
  '9:30 Conservative': { score: 25, edge: 4.5, risk: 56, safety: 6, label: 'Fewer calls, cleaner' },
  'Value Hunter': { score: 16, edge: 5.5, risk: 70, safety: 5.5, label: 'Only when price is favorable' },
  'Paper Test': { score: 8, edge: -99, risk: 99, safety: 0, label: 'Always show model lean' },
  'No-Trade Guardian': { score: 31, edge: 6, risk: 48, safety: 8, label: 'Rare, strongest-only' }
};

function getManualNumber(id) {
  const v = Number($(id).value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function getActiveInputs(data) {
  const market = data?.kalshi?.market || null;
  const cb = data?.coinbase || null;
  const orderbook = data?.kalshi?.orderbook || null;
  const price = getManualNumber('manualPrice') ?? data?.btc?.price ?? cb?.price ?? data?.binance?.markPrice ?? null;
  const target = getManualNumber('manualTarget') ?? market?.target ?? null;
  const yesAsk = getManualNumber('manualYesAsk') ?? market?.yesAsk ?? orderbook?.impliedYesAsk ?? null;
  const noAsk = getManualNumber('manualNoAsk') ?? market?.noAsk ?? orderbook?.impliedNoAsk ?? null;
  const yesBid = market?.yesBid ?? orderbook?.bestYesBid ?? null;
  const noBid = market?.noBid ?? orderbook?.bestNoBid ?? null;
  const close = market?.closeTime ? Date.parse(market.closeTime) : null;
  const open = market?.openTime ? Date.parse(market.openTime) : (close ? close - 15 * 60_000 : null);
  const minutesRemaining = close ? Math.max(0, (close - Date.now()) / 60000) : null;
  const marketAge = open ? Math.max(0, (Date.now() - open) / 60000) : null;
  return { market, cb, orderbook, price, target, yesAsk, noAsk, yesBid, noBid, close, open, minutesRemaining, marketAge };
}

function addHistory(data) {
  const x = getActiveInputs(data);
  if (!Number.isFinite(x.price)) return;
  state.history.push({
    t: Date.now(),
    marketTicker: x.market?.ticker || null,
    price: x.price,
    target: x.target,
    yesAsk: x.yesAsk,
    noAsk: x.noAsk,
    yesBid: x.yesBid,
    noBid: x.noBid
  });
  state.history = state.history.filter(p => p.t > Date.now() - 1000 * 60 * 120).slice(-1500);
  localStorage.setItem(STORAGE.history, JSON.stringify(state.history));
}

function currentMarketHistory(x) {
  const ticker = x.market?.ticker || null;
  if (ticker) {
    const same = state.history.filter(p => p.marketTicker === ticker);
    if (same.length) return same;
  }
  if (x.open) return state.history.filter(p => p.t >= x.open - 60_000);
  return state.history;
}

function pointAgo(ms) {
  const cutoff = Date.now() - ms;
  let best = null;
  for (const p of state.history) {
    if (p.t <= cutoff) best = p;
    else break;
  }
  return best || state.history[0] || null;
}

function delta(price, ms) {
  const p = pointAgo(ms);
  return p?.price ? price - p.price : 0;
}

function oddsDelta(side, ms) {
  const p = pointAgo(ms);
  const current = state.history[state.history.length - 1] || null;
  if (!p || !current) return 0;
  if (side === 'YES') return (current.yesAsk ?? 0) - (p.yesAsk ?? 0);
  return (current.noAsk ?? 0) - (p.noAsk ?? 0);
}

function lastCandlesScore(candles = []) {
  if (!candles.length) return { score: 0, label: 'No candle data' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const body = (last.close || 0) - (last.open || 0);
  const range = Math.max(1, (last.high || 0) - (last.low || 0));
  const prevBody = (prev.close || 0) - (prev.open || 0);
  const wickTop = (last.high || 0) - Math.max(last.open || 0, last.close || 0);
  const wickBottom = Math.min(last.open || 0, last.close || 0) - (last.low || 0);
  const bodyScore = clamp((body / range) * 7, -7, 7);
  const follow = Math.sign(body) === Math.sign(prevBody) ? Math.sign(body) * 2 : 0;
  const rejection = wickBottom > wickTop * 1.7 ? 2 : wickTop > wickBottom * 1.7 ? -2 : 0;
  return { score: bodyScore + follow + rejection, label: `${body >= 0 ? 'Green' : 'Red'} 1m candle, body ${body.toFixed(2)}, wick read ${rejection}` };
}

function windowStatus(minutes) {
  if (!Number.isFinite(minutes)) return { label: 'Unknown window', code: 'unknown', risk: 10, inWindow: false };
  if (minutes > 10.5) return { label: 'Too early - collecting baseline', code: 'early', risk: 10, inWindow: false };
  if (minutes > 10) return { label: 'Staging - model opens at 10:00', code: 'staging', risk: 4, inWindow: false };
  if (minutes >= 9) return { label: 'LIVE 9:00-10:00 prediction window', code: 'live', risk: -8, inWindow: true };
  if (minutes >= 8.5) return { label: 'Just past test window', code: 'post', risk: 6, inWindow: false };
  if (minutes >= 5) return { label: 'Too late for this 9:30 model', code: 'late', risk: 13, inWindow: false };
  if (minutes > 1) return { label: 'Late-market danger', code: 'danger', risk: 22, inWindow: false };
  return { label: 'Expiration danger', code: 'expire', risk: 32, inWindow: false };
}

function tradePressure(trades = []) {
  const cutoff = Date.now() - 90_000;
  let yesVol = 0;
  let noVol = 0;
  let yesPriceSum = 0;
  let noPriceSum = 0;
  let count = 0;
  for (const t of trades || []) {
    const ts = Date.parse(t.created_time || t.time || 0);
    if (Number.isFinite(ts) && ts < cutoff) continue;
    const size = Number(t.count_fp ?? t.count ?? t.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) continue;
    const taker = String(t.taker_side || t.taker_outcome_side || '').toLowerCase();
    const yesPx = Number(t.yes_price_dollars ?? t.yes_price ?? NaN) * (Number(t.yes_price_dollars ?? t.yes_price ?? NaN) <= 1 ? 100 : 1);
    const noPx = Number(t.no_price_dollars ?? t.no_price ?? NaN) * (Number(t.no_price_dollars ?? t.no_price ?? NaN) <= 1 ? 100 : 1);
    if (taker.includes('yes')) {
      yesVol += size;
      if (Number.isFinite(yesPx)) yesPriceSum += yesPx * size;
    } else if (taker.includes('no')) {
      noVol += size;
      if (Number.isFinite(noPx)) noPriceSum += noPx * size;
    }
    count += 1;
  }
  const total = yesVol + noVol;
  const pressure = total ? ((yesVol - noVol) / total) * 100 : 0;
  return {
    pressure,
    yesVol,
    noVol,
    count,
    avgYesPrice: yesVol ? yesPriceSum / yesVol : null,
    avgNoPrice: noVol ? noPriceSum / noVol : null
  };
}

function consistencyScore(history, price) {
  if (history.length < 5) return { score: 0, label: 'Collecting points' };
  const recent = history.slice(-10);
  let up = 0, down = 0;
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i].price - recent[i - 1].price;
    if (d > 0) up += 1;
    if (d < 0) down += 1;
  }
  const total = Math.max(1, up + down);
  const pressure = ((up - down) / total) * 100;
  return { score: clamp(pressure / 8, -8, 8), label: `${up} upticks / ${down} downticks` };
}

function analyze(data) {
  const x = getActiveInputs(data);
  const reasons = [];
  const warnings = [];
  const signalRows = [];
  const valueRows = [];
  const riskRows = [];
  const entryRows = [];

  if (!Number.isFinite(x.price)) warnings.push('BTC price missing. Coinbase endpoint or manual price needed.');
  if (!Number.isFinite(x.target)) warnings.push('Kalshi target missing. Add manual target until API exposes it.');

  const selectedProfile = $('profileSelect').value || '9:30 Predictor';
  const profile = profiles[selectedProfile] || profiles['9:30 Predictor'];
  const price = x.price || 0;
  const target = x.target || null;
  const distance = target ? price - target : 0;
  const distPct = target ? (distance / price) * 100 : 0;
  const hist = currentMarketHistory(x);
  const baseline = hist[0] || null;
  const openDelta = baseline?.price ? price - baseline.price : 0;

  const d15 = delta(price, 15_000);
  const d30 = delta(price, 30_000);
  const d60 = delta(price, 60_000);
  const d180 = delta(price, 180_000);
  const d300 = delta(price, 300_000);

  const norm = price * 0.00032 || 20;
  const momentumScore =
    tanh(d30 / norm) * 7 +
    tanh(d60 / (norm * 1.2)) * 10 +
    tanh(d180 / (norm * 2.0)) * 9 +
    tanh(d300 / (norm * 3.0)) * 5;
  const distanceScore = target ? tanh(distance / (price * 0.00075)) * 24 : 0;
  const openMoveScore = baseline ? tanh(openDelta / (price * 0.0010)) * 17 : 0;
  const candle = lastCandlesScore(data?.coinbase?.candles || []);
  const cbBookScore = clamp((data?.coinbase?.book?.imbalance || 0) / 5, -10, 10);
  const book = x.orderbook || {};
  const bookDepthScore = clamp((book.pressure || 0) / 4, -10, 10);
  const yesMid = Number.isFinite(x.yesBid) && Number.isFinite(x.yesAsk) ? (x.yesBid + x.yesAsk) / 2 : null;
  const marketOddsScore = Number.isFinite(yesMid) ? clamp((yesMid - 50) * 0.42, -12, 12) : 0;
  const tPressure = tradePressure(data?.kalshi?.trades || []);
  const tradeScore = clamp(tPressure.pressure / 6, -12, 12);
  const oddsMoveScore = clamp((oddsDelta('YES', 60_000) - oddsDelta('NO', 60_000)) * 1.5, -10, 10);
  const consistency = consistencyScore(hist, price);
  const futuresScore = clamp((data?.binance?.priceChangePercent24h || 0) / 3.2, -4, 4);

  const rawScore = momentumScore + distanceScore + openMoveScore + candle.score + cbBookScore + bookDepthScore + marketOddsScore + tradeScore + oddsMoveScore + consistency.score + futuresScore;
  const score = clamp(rawScore, -60, 60);
  const upProb = clamp(50 + score * 0.72, 5, 95);
  const downProb = 100 - upProb;
  const direction = upProb >= downProb ? 'YES' : 'NO';
  const directionLabel = direction === 'YES' ? 'UP / YES' : 'DOWN / NO';
  const confidence = direction === 'YES' ? upProb : downProb;
  const predictionStrength = Math.abs(score);
  const strengthLabel = predictionStrength >= 34 ? 'Strong' : predictionStrength >= 22 ? 'Medium' : predictionStrength >= 12 ? 'Light' : 'Weak';
  const currentAsk = direction === 'YES' ? x.yesAsk : x.noAsk;
  const fairPrice = confidence * 0.985;
  const safety = profile.safety ?? 4;
  const maxBuy = fairPrice - safety;
  const edge = Number.isFinite(currentAsk) ? fairPrice - currentAsk : null;

  const spreadYes = Number.isFinite(x.yesAsk) && Number.isFinite(x.yesBid) ? x.yesAsk - x.yesBid : null;
  const spreadNo = Number.isFinite(x.noAsk) && Number.isFinite(x.noBid) ? x.noAsk - x.noBid : null;
  const activeSpread = direction === 'YES' ? spreadYes : spreadNo;
  const volIndex = data?.deribit?.volatilityIndex ?? null;
  const funding = data?.binance?.latestFundingRate ?? null;
  const window = windowStatus(x.minutesRemaining);

  const whipsaw = Math.sign(d30) && Math.sign(d180) && Math.sign(d30) !== Math.sign(d180);
  const closeToTarget = target ? Math.abs(distPct) < 0.025 : true;
  const kalshiConflict = direction === 'YES' ? tPressure.pressure < -18 : tPressure.pressure > 18;
  const coinbaseConflict = direction === 'YES' ? cbBookScore < -3 : cbBookScore > 3;
  const candleConflict = direction === 'YES' ? candle.score < -2 : candle.score > 2;

  let alignment = 0;
  const sign = direction === 'YES' ? 1 : -1;
  [momentumScore, distanceScore, openMoveScore, candle.score, cbBookScore, bookDepthScore, marketOddsScore, tradeScore, oddsMoveScore, consistency.score].forEach(v => {
    if (Math.sign(v) === sign && Math.abs(v) > 1.5) alignment += 1;
  });

  let risk = 32;
  risk += window.risk;
  risk += predictionStrength < 12 ? 24 : predictionStrength < 22 ? 12 : predictionStrength < 32 ? 4 : -4;
  risk += closeToTarget ? 14 : 0;
  risk += whipsaw ? 15 : 0;
  risk += Number.isFinite(activeSpread) && activeSpread > 6 ? 8 : 0;
  risk += Number.isFinite(activeSpread) && activeSpread > 10 ? 8 : 0;
  risk += Number.isFinite(volIndex) && volIndex > 70 ? 8 : 0;
  risk += Number.isFinite(funding) && Math.abs(funding) > 0.00018 ? 4 : 0;
  risk += kalshiConflict ? 10 : 0;
  risk += coinbaseConflict ? 5 : 0;
  risk += candleConflict ? 5 : 0;
  risk += edge !== null && edge < -3 ? 10 : 0;
  risk -= alignment >= 6 ? 8 : alignment >= 4 ? 4 : 0;
  risk = clamp(Math.round(risk), 1, 99);

  signalRows.push(['9:30 composite score', `${score >= 0 ? '+' : ''}${score.toFixed(1)} (${strengthLabel})`]);
  signalRows.push(['BTC from market baseline', baseline ? `${openDelta >= 0 ? '+' : ''}${openDelta.toFixed(2)} since first tracked print` : 'Collecting baseline']);
  signalRows.push(['BTC micro momentum', `${d30 >= 0 ? '+' : ''}${d30.toFixed(2)} / 30s, ${d180 >= 0 ? '+' : ''}${d180.toFixed(2)} / 3m`]);
  signalRows.push(['Distance to Kalshi target', target ? `${distance >= 0 ? 'Above' : 'Below'} by ${fmtUsd(Math.abs(distance))}` : 'Missing target']);
  signalRows.push(['Coinbase orderbook', `${(data?.coinbase?.book?.imbalance ?? 0).toFixed(1)}% imbalance`]);
  signalRows.push(['Kalshi top-book/odds', Number.isFinite(yesMid) ? `YES mid ${yesMid.toFixed(1)}¢, score ${marketOddsScore.toFixed(1)}` : 'Missing YES mid']);
  signalRows.push(['Kalshi recent trades', `${tPressure.pressure >= 0 ? 'YES' : 'NO'} pressure ${Math.abs(tPressure.pressure).toFixed(1)}%, ${Math.round(tPressure.yesVol)}Y / ${Math.round(tPressure.noVol)}N`]);
  signalRows.push(['Tape consistency', consistency.label]);
  signalRows.push(['1m candle read', candle.label]);

  valueRows.push(['Prediction', directionLabel]);
  valueRows.push(['Estimated chance', `${confidence.toFixed(1)}%`]);
  valueRows.push(['Fair price', fmtC(fairPrice)]);
  valueRows.push(['Safety discount', `${safety.toFixed(1)}¢`]);
  valueRows.push(['Max buy', fmtC(maxBuy)]);
  valueRows.push(['Current ask', Number.isFinite(currentAsk) ? fmtC(currentAsk) : 'Missing']);
  valueRows.push(['Edge', edge !== null ? `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}¢` : 'Missing ask']);

  riskRows.push(['9:30 window', window.label]);
  riskRows.push(['Market age', Number.isFinite(x.marketAge) ? `${x.marketAge.toFixed(1)} minutes` : 'Unknown']);
  riskRows.push(['Close to target', closeToTarget ? 'Yes - flip risk' : 'No']);
  riskRows.push(['Whipsaw check', whipsaw ? 'Warning' : 'Clean enough']);
  riskRows.push(['Spread', Number.isFinite(activeSpread) ? `${activeSpread.toFixed(1)}¢` : 'Missing']);
  riskRows.push(['Signal alignment', `${alignment}/10 major inputs agree`]);
  riskRows.push(['DVOL regime', Number.isFinite(volIndex) ? volIndex.toFixed(2) : 'Unavailable']);

  if (target && price) reasons.push(`${directionLabel} is the 9:30 model prediction because the composite score is ${score >= 0 ? 'positive' : 'negative'} and BTC is ${distance >= 0 ? 'above' : 'below'} the Kalshi target.`);
  if (baseline) reasons.push(`Since the first tracked print in this market, BTC moved ${openDelta >= 0 ? '+' : ''}${openDelta.toFixed(2)}.`);
  if (edge !== null && edge > 0) reasons.push(`Value is positive by ${edge.toFixed(1)}¢ versus the model fair price.`);
  if (edge !== null && edge < 0) warnings.push(`Prediction may be directionally right, but the contract is overpriced by ${Math.abs(edge).toFixed(1)}¢.`);
  if (closeToTarget) warnings.push('BTC is close to the target; the 9-minute read can flip quickly.');
  if (whipsaw) warnings.push('Short-term momentum disagrees with 3-minute momentum; trap risk is elevated.');
  if (!window.inWindow && window.code !== 'staging') warnings.push('This model is designed to be judged only from 10:00 through 9:00 remaining.');

  const profileResults = Object.entries(profiles).map(([name, p]) => {
    const scoreOk = predictionStrength >= p.score;
    const edgeOk = edge !== null && edge >= p.edge;
    const riskOk = risk <= p.risk;
    const dataOk = Number.isFinite(price) && Number.isFinite(target) && Number.isFinite(currentAsk);
    const windowOk = window.inWindow;
    const take = dataOk && windowOk && scoreOk && edgeOk && riskOk && name !== 'Paper Test';
    let call = 'WAIT WINDOW';
    if (window.code === 'post' || window.code === 'late' || window.code === 'danger' || window.code === 'expire') call = 'WINDOW PASSED';
    if (window.inWindow) call = scoreOk ? `PREDICT ${direction}` : 'WEAK / SKIP';
    if (take) call = `TAKE ${direction}`;
    if (window.inWindow && scoreOk && riskOk && !edgeOk && name !== 'Paper Test') call = `PREDICT ${direction} / WAIT PRICE`;
    if (name === 'Paper Test' && window.inWindow) call = `PAPER ${direction}`;
    return { name, call, take, scoreOk, edgeOk, riskOk, windowOk };
  });

  const selectedProfileResult = profileResults.find(p => p.name === selectedProfile) || profileResults[0];
  const guardian = profileResults.find(p => p.name === 'No-Trade Guardian');
  const consensusPredict = profileResults.filter(p => p.call.includes(direction) && !p.name.includes('Guardian')).length;
  const consensusTake = profileResults.filter(p => p.take && !p.name.includes('Guardian')).length;

  let finalAction = 'WAIT FOR 10:00';
  let entryState = 'Collecting pre-window data';
  let finalWhy = 'The 9:30 model opens at 10:00 remaining and is judged until 9:00 remaining.';

  if (!Number.isFinite(price) || !Number.isFinite(target)) {
    finalAction = 'DATA NEEDED';
    entryState = 'Waiting for BTC price / Kalshi target';
    finalWhy = 'Add a manual target if Kalshi does not expose it yet.';
  } else if (window.inWindow) {
    if (guardian?.take) {
      finalAction = `TAKE ${direction}`;
      entryState = 'Guardian-approved 9:30 entry';
      finalWhy = reasons.join(' ') || 'Strong signal, positive value, and low risk.';
    } else if (selectedProfileResult.take) {
      finalAction = `TAKE ${direction}`;
      entryState = '9:30 entry valid';
      finalWhy = reasons.join(' ') || 'Selected profile allows the entry.';
    } else if (predictionStrength >= profile.score && risk <= profile.risk && edge !== null && edge < profile.edge) {
      finalAction = `PREDICT ${direction} / WAIT PRICE`;
      entryState = `Prediction valid, price not good enough`;
      finalWhy = `Model predicts ${directionLabel}, but max buy is ${fmtC(maxBuy)} and current ask is ${fmtC(currentAsk)}.`;
    } else if (predictionStrength >= Math.max(8, profile.score * 0.6)) {
      finalAction = `PREDICT ${direction} / PAPER ONLY`;
      entryState = `${strengthLabel} 9:30 prediction`;
      finalWhy = warnings.length ? warnings.join(' ') : `Use this as a paper-test prediction; trade filters are not fully satisfied.`;
    } else {
      finalAction = 'SKIP / TOO WEAK';
      entryState = 'No clean 9:30 edge';
      finalWhy = 'The 9:30 model does not have enough signal strength.';
    }
  } else if (window.code === 'staging' || window.code === 'early') {
    finalAction = `STAGING ${direction}`;
    entryState = 'Pre-window lean only';
    finalWhy = `Pre-window lean is ${directionLabel}. Do not judge the model until 10:00-9:00 remaining.`;
  } else {
    finalAction = 'WINDOW PASSED';
    entryState = '9:30 test window closed';
    finalWhy = `Current lean is ${directionLabel}, but this model should be tested only at 10:00-9:00 remaining.`;
  }

  if (risk >= 82 && finalAction.startsWith('TAKE')) {
    finalAction = `PREDICT ${direction} / RISK BLOCKED`;
    entryState = 'Blocked by risk guard';
    finalWhy = 'Signal exists, but the risk guard blocked the live entry.';
  }

  entryRows.push(['Test window', 'Only judge predictions made from 10:00 through 9:00 remaining.']);
  entryRows.push(['Window status', window.label]);
  entryRows.push(['Model prediction', `${directionLabel} — ${strengthLabel}`]);
  entryRows.push(['Trade rule', `Only take ${direction} at ${fmtC(maxBuy)} or better, and only inside the 10:00-9:00 window.`]);
  entryRows.push(['Profile rule', `${selectedProfile}: score ≥ ${profile.score}, edge ≥ ${profile.edge}¢, risk ≤ ${profile.risk}`]);
  entryRows.push(['Consensus', `${consensusTake} take / ${consensusPredict} predict-or-better profiles`]);
  entryRows.push(['BRTI caveat', 'Coinbase is only a proxy; Kalshi resolves from CF Benchmarks BRTI average.']);

  return {
    x, score, rawScore, upProb, downProb, direction, directionLabel, confidence,
    currentAsk, fairPrice, maxBuy, edge, risk, finalAction, entryState, finalWhy,
    reasons, warnings, signalRows, valueRows, riskRows, entryRows, profileResults,
    selectedProfile, distance, distPct, d15, d30, d60, d180, d300, openDelta,
    window, predictionStrength, strengthLabel, alignment, baseline, tPressure
  };
}

function row(label, value, cls = '') {
  return `<div class="row"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

function maybeAutoSnapshot(d) {
  const ticker = d.x.market?.ticker;
  if (!ticker || !d.window.inWindow) return;
  const key = `${ticker}:930`;
  if (state.snapshots.some(s => s.key === key)) return;
  const snap = {
    key,
    loggedAt: new Date().toISOString(),
    marketTicker: ticker,
    target: d.x.target,
    btcPrice: d.x.price,
    minutesRemaining: Number(d.x.minutesRemaining?.toFixed?.(2) ?? null),
    action: d.finalAction,
    direction: d.direction,
    confidence: Number(d.confidence.toFixed(2)),
    risk: d.risk,
    score: Number(d.score.toFixed(2)),
    currentAsk: Number.isFinite(d.currentAsk) ? Number(d.currentAsk.toFixed(2)) : null,
    fairPrice: Number(d.fairPrice.toFixed(2)),
    maxBuy: Number(d.maxBuy.toFixed(2)),
    edge: d.edge !== null ? Number(d.edge.toFixed(2)) : null,
    strength: d.strengthLabel,
    reason: d.finalWhy
  };
  state.snapshots.unshift(snap);
  state.snapshots = state.snapshots.slice(0, 500);
  localStorage.setItem(STORAGE.snapshots, JSON.stringify(state.snapshots));
}

function render() {
  const data = state.latest;
  if (!data) return;
  const d = analyze(data);
  state.decision = d;
  maybeAutoSnapshot(d);
  const x = d.x;
  const tw = d.window;

  $('btcPrice').textContent = fmtUsd(x.price);
  $('btcMeta').textContent = data.btc?.time ? `${data.btc.source || 'BTC source'} ${new Date(data.btc.time).toLocaleTimeString()}` : data.coinbase?.time ? `Coinbase ${new Date(data.coinbase.time).toLocaleTimeString()}` : 'BTC source / fallback';
  $('targetPrice').textContent = fmtUsd(x.target);
  $('targetMeta').textContent = x.market?.ticker || 'Manual / waiting';
  $('timeRemaining').textContent = Number.isFinite(x.minutesRemaining) ? `${Math.floor(x.minutesRemaining)}:${String(Math.floor((x.minutesRemaining % 1) * 60)).padStart(2, '0')}` : '--';
  $('windowLabel').textContent = tw.label;
  $('distanceRead').textContent = x.target ? `${d.distance >= 0 ? '+' : '-'}${fmtUsd(Math.abs(d.distance))}` : '--';
  $('distanceMeta').textContent = x.target ? `${d.distPct >= 0 ? '+' : ''}${d.distPct.toFixed(3)}% from target` : '--';

  $('finalAction').textContent = d.finalAction;
  $('finalWhy').textContent = d.finalWhy;
  $('directionBadge').textContent = d.directionLabel;
  $('directionBadge').className = `bigbadge ${d.direction === 'YES' ? 'up' : 'down'}`;
  $('confidenceRead').textContent = `${d.confidence.toFixed(1)}%`;
  $('riskRead').textContent = `${d.risk}/100`;
  $('riskRead').className = d.risk > 74 ? 'badtext' : d.risk > 55 ? 'warntext' : 'goodtext';
  $('fairPriceRead').textContent = fmtC(d.fairPrice);
  $('maxBuyRead').textContent = fmtC(d.maxBuy);
  $('currentAskRead').textContent = fmtC(d.currentAsk);
  $('scoreRead').textContent = `9:30 score ${d.score.toFixed(1)}`;
  $('scoreBar').style.left = `${clamp(50 + d.score * 0.75, 2, 98)}%`;
  $('entryState').textContent = d.entryState;
  $('entryState').className = `pill ${d.finalAction.startsWith('TAKE') ? 'good' : d.finalAction.includes('WAIT') || d.finalAction.includes('STAGING') || d.finalAction.includes('PREDICT') ? 'warn' : 'bad'}`;
  $('marketTicker').textContent = x.market?.ticker || 'No open market found';

  $('profilesTable').innerHTML = d.profileResults.map(p => {
    const active = p.name === d.selectedProfile ? 'active' : '';
    const cls = p.take ? 'goodtext' : p.call.includes('PREDICT') || p.call.includes('PAPER') ? 'warntext' : 'badtext';
    return `<div class="row ${active}"><div class="profile-name">${p.name}</div><strong class="${cls}">${p.call}</strong></div>`;
  }).join('');

  $('entryDetails').innerHTML = d.entryRows.map(([a,b]) => row(a,b)).join('');
  $('signalBoard').innerHTML = d.signalRows.map(([a,b]) => row(a,b)).join('');
  $('valueBoard').innerHTML = d.valueRows.map(([a,b]) => row(a,b, String(b).startsWith('+') ? 'goodtext' : String(b).startsWith('-') ? 'badtext' : '')).join('');
  $('riskBoard').innerHTML = d.riskRows.map(([a,b]) => row(a,b, String(b).includes('Warning') || String(b).includes('risk') || String(b).includes('late') ? 'warntext' : '')).join('');

  const sources = [];
  sources.push(['Kalshi', data.kalshi?.market?.ticker ? 'OK - live market found' : 'Issue']);
  sources.push(['BTC spot fallback', data.btc?.price ? `OK - ${data.btc.source || 'source'}` : 'Issue']);
  sources.push(['Coinbase spot/candles/book', data.coinbase?.ok ? 'OK' : 'Issue']);
  sources.push(['Binance futures regime', data.binance?.ok ? 'OK' : 'Issue']);
  sources.push(['Deribit volatility', data.deribit?.ok ? 'OK' : 'Issue']);
  sources.push(['Kalshi YES/NO ask', `YES ${fmtC(x.yesAsk)} / NO ${fmtC(x.noAsk)}`]);
  sources.push(['Fetch mode', data.fetchMode || 'api-all']);
  sources.push(['Auto 9:30 snapshots', String(state.snapshots.length)]);
  sources.push(['Kalshi book depth', x.orderbook ? `YES ${Math.round(x.orderbook.yesDepth || 0)} / NO ${Math.round(x.orderbook.noDepth || 0)}` : 'Unavailable']);
  $('dataSources').innerHTML = sources.map(([a,b]) => row(a,b, b === 'OK' || String(b).startsWith('OK') ? 'goodtext' : b === 'Issue' ? 'warntext' : '')).join('');

  $('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  updateDiagnostics();
  renderTracker();
}

function updateDiagnostics(extra = null) {
  const payload = {
    model: 'Genesis-025 9:30 Predictor',
    testRule: 'Judge predictions only from 10:00 through 9:00 remaining.',
    lastDecision: state.decision ? {
      action: state.decision.finalAction,
      direction: state.decision.directionLabel,
      confidence: state.decision.confidence,
      risk: state.decision.risk,
      score: state.decision.score,
      strength: state.decision.strengthLabel,
      fairPrice: state.decision.fairPrice,
      maxBuy: state.decision.maxBuy,
      currentAsk: state.decision.currentAsk,
      profile: state.decision.selectedProfile,
      minutesRemaining: state.decision.x.minutesRemaining,
      marketAge: state.decision.x.marketAge,
      reason: state.decision.finalWhy
    } : null,
    latestAutoSnapshots: state.snapshots.slice(0, 5),
    latestErrors: {
      kalshi: state.latest?.kalshi?.error || state.latest?.kalshi?.diagnostics || null,
      btc: state.latest?.btc?.errors || state.latest?.btc?.error || null,
      coinbase: state.latest?.coinbase?.errors || state.latest?.coinbase?.error || null,
      binance: state.latest?.binance?.errors || state.latest?.binance?.error || null,
      deribit: state.latest?.deribit?.error || null
    },
    extra
  };
  $('diagnostics').textContent = JSON.stringify(payload, null, 2);
}

async function getJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${path}${sep}_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

function settledValue(entry, fallback) {
  return entry.status === 'fulfilled' ? entry.value : fallback;
}

async function directDataFetch() {
  const [kalshi, btc, coinbase, binance, deribit] = await Promise.allSettled([
    getJson('/api/kalshi?series=KXBTC15M'),
    getJson('/api/btc'),
    getJson('/api/coinbase?light=1'),
    getJson('/api/binance'),
    getJson('/api/deribit')
  ]);
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    fetchMode: 'direct-browser-api-calls',
    kalshi: settledValue(kalshi, { ok: false, error: String(kalshi.reason) }),
    btc: settledValue(btc, { ok: false, error: String(btc.reason) }),
    coinbase: settledValue(coinbase, { ok: false, error: String(coinbase.reason) }),
    binance: settledValue(binance, { ok: false, error: String(binance.reason) }),
    deribit: settledValue(deribit, { ok: false, error: String(deribit.reason) }),
    endpointErrors: [
      kalshi.status === 'rejected' ? { source: 'kalshi', error: String(kalshi.reason) } : null,
      btc.status === 'rejected' ? { source: 'btc', error: String(btc.reason) } : null,
      coinbase.status === 'rejected' ? { source: 'coinbase', error: String(coinbase.reason) } : null,
      binance.status === 'rejected' ? { source: 'binance', error: String(binance.reason) } : null,
      deribit.status === 'rejected' ? { source: 'deribit', error: String(deribit.reason) } : null
    ].filter(Boolean)
  };
}

function hasUsableLiveData(data) {
  return Boolean(data?.btc?.price && data?.kalshi?.market?.ticker);
}

async function refresh() {
  if (state.paused) return;
  try {
    let data = await directDataFetch();
    try {
      const allData = await getJson('/api/all');
      data.allEndpoint = {
        ok: allData.ok !== false,
        hasBtc: Boolean(allData?.btc?.price),
        hasKalshi: Boolean(allData?.kalshi?.market?.ticker),
        errors: allData.errors || []
      };
      if (!hasUsableLiveData(data) && hasUsableLiveData(allData)) {
        data = { ...allData, fetchMode: 'api-all-fallback', allEndpoint: data.allEndpoint };
      }
    } catch (allErr) {
      data.allEndpoint = { ok: false, error: String(allErr) };
    }

    if (!state.cachedCandles.length || Date.now() - state.lastCandlesFetch > 60_000) {
      try {
        const candles = await getJson('/api/candles?minutes=120');
        state.cachedCandles = candles.candles || [];
        state.lastCandlesFetch = Date.now();
      } catch (candleErr) {
        data.candleEndpointError = String(candleErr);
      }
    }
    data.coinbase = data.coinbase || {};
    data.coinbase.candles = state.cachedCandles;
    state.latest = data;
    addHistory(data);
    render();
  } catch (err) {
    state.diagnostics.push({ time: new Date().toISOString(), error: String(err) });
    updateDiagnostics({ refreshError: String(err) });
  }
}

async function runApiTest() {
  const paths = ['/api/health', '/api/kalshi?series=KXBTC15M', '/api/btc', '/api/coinbase', '/api/candles', '/api/binance', '/api/deribit'];
  const results = [];
  for (const path of paths) {
    const start = performance.now();
    try {
      const json = await getJson(path);
      results.push({ path, ok: json.ok !== false, ms: Math.round(performance.now() - start), summary: summarizeApi(path, json) });
    } catch (err) {
      results.push({ path, ok: false, ms: Math.round(performance.now() - start), error: String(err) });
    }
  }
  updateDiagnostics({ apiTest: results });
}

function summarizeApi(path, json) {
  if (path.includes('kalshi')) return { market: json.market?.ticker, target: json.market?.target, candidates: json.candidates?.length, trades: json.trades?.length, diagnostics: json.diagnostics?.slice?.(0, 3) };
  if (path.includes('btc')) return { price: json.price, source: json.source, bid: json.bid, ask: json.ask };
  if (path.includes('coinbase')) return { price: json.price, candles: json.candles?.length, book: Boolean(json.book) };
  if (path.includes('candles')) return { candles: json.candles?.length };
  if (path.includes('binance')) return { openInterest: json.openInterest, funding: json.latestFundingRate };
  if (path.includes('deribit')) return { volatilityIndex: json.volatilityIndex, points: json.points?.length };
  return json;
}

function logResult(result) {
  if (!state.decision) return;
  const d = state.decision;
  const x = d.x;
  const item = {
    loggedAt: new Date().toISOString(),
    model: 'Genesis-025 9:30 Predictor',
    result,
    profile: d.selectedProfile,
    action: d.finalAction,
    direction: d.direction,
    confidence: Number(d.confidence.toFixed(2)),
    risk: d.risk,
    score: Number(d.score.toFixed(2)),
    strength: d.strengthLabel,
    fairPrice: Number(d.fairPrice.toFixed(2)),
    maxBuy: Number(d.maxBuy.toFixed(2)),
    currentAsk: Number.isFinite(d.currentAsk) ? Number(d.currentAsk.toFixed(2)) : null,
    edge: d.edge !== null ? Number(d.edge.toFixed(2)) : null,
    btcPrice: x.price,
    target: x.target,
    distance: Number(d.distance.toFixed(2)),
    minutesRemaining: Number.isFinite(x.minutesRemaining) ? Number(x.minutesRemaining.toFixed(2)) : null,
    marketAge: Number.isFinite(x.marketAge) ? Number(x.marketAge.toFixed(2)) : null,
    in930Window: d.window.inWindow,
    marketTicker: x.market?.ticker || null,
    reason: d.finalWhy
  };
  state.logs.unshift(item);
  state.logs = state.logs.slice(0, 3000);
  localStorage.setItem(STORAGE.logs, JSON.stringify(state.logs));
  renderTracker();
}

function renderTracker() {
  const logs = state.logs;
  const wins = logs.filter(x => x.result === 'WIN').length;
  const losses = logs.filter(x => x.result === 'LOSS').length;
  const noTrades = logs.filter(x => x.result === 'NO_TRADE').length;
  const scored = wins + losses;
  const wr = scored ? (wins / scored) * 100 : 0;
  $('trackerSummary').innerHTML = [
    ['Wins', wins], ['Losses', losses], ['No-trades', noTrades], ['9:30 snapshots', state.snapshots.length], ['Win rate', scored ? `${wr.toFixed(1)}%` : '--']
  ].map(([a,b]) => `<div><span>${a}</span><strong>${b}</strong></div>`).join('');
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = [...state.logs];
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n');
  download(`edge15-930-results-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
}

function exportJson() {
  download(`edge15-930-results-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ logs: state.logs, snapshots: state.snapshots }, null, 2), 'application/json');
}

function bind() {
  $('refreshBtn').addEventListener('click', refresh);
  $('pauseBtn').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pauseBtn').textContent = state.paused ? 'Resume' : 'Pause';
    if (!state.paused) refresh();
  });
  $('testApiBtn').addEventListener('click', runApiTest);
  $('copyDiagBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('diagnostics').textContent || '');
    $('copyDiagBtn').textContent = 'Copied';
    setTimeout(() => $('copyDiagBtn').textContent = 'Copy diagnostics', 1200);
  });
  $('profileSelect').addEventListener('change', render);
  ['manualTarget','manualPrice','manualYesAsk','manualNoAsk'].forEach(id => $(id).addEventListener('input', render));
  $('logWinBtn').addEventListener('click', () => logResult('WIN'));
  $('logLossBtn').addEventListener('click', () => logResult('LOSS'));
  $('logNoTradeBtn').addEventListener('click', () => logResult('NO_TRADE'));
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('clearLogsBtn').addEventListener('click', () => {
    if (confirm('Clear Genesis-025 local result logs and snapshots?')) {
      state.logs = [];
      state.snapshots = [];
      localStorage.removeItem(STORAGE.logs);
      localStorage.removeItem(STORAGE.snapshots);
      renderTracker();
    }
  });
}

bind();
renderTracker();
refresh();
state.interval = setInterval(refresh, 5000);
