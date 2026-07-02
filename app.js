const $ = id => document.getElementById(id);
const fmtUsd = n => Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '--';
const fmtC = n => Number.isFinite(n) ? `${Math.round(n)}¢` : '--';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const tanh = Math.tanh;

const state = {
  paused: false,
  interval: null,
  latest: null,
  decision: null,
  history: JSON.parse(localStorage.getItem('edge15_history_v24') || '[]'),
  logs: JSON.parse(localStorage.getItem('edge15_logs_v24') || '[]'),
  diagnostics: [],
  lastCandlesFetch: 0,
  cachedCandles: []
};

const profiles = {
  'Balanced': { score: 20, edge: 3, risk: 65, minMin: 2.25, maxMin: 12.5, safety: 4 },
  'Aggressive': { score: 15, edge: 2, risk: 76, minMin: 1.5, maxMin: 13.5, safety: 3 },
  'Conservative': { score: 28, edge: 5, risk: 55, minMin: 3, maxMin: 10, safety: 6 },
  'Early Trend': { score: 18, edge: 2, risk: 70, minMin: 5, maxMin: 12.5, safety: 3.5 },
  'Late Sniper': { score: 34, edge: 3, risk: 58, minMin: 0.9, maxMin: 4.5, safety: 5 },
  'No-Trade Guardian': { score: 38, edge: 6, risk: 45, minMin: 3.5, maxMin: 8.5, safety: 8 }
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
  const minutesRemaining = close ? Math.max(0, (close - Date.now()) / 60000) : null;
  return { market, cb, orderbook, price, target, yesAsk, noAsk, yesBid, noBid, close, minutesRemaining };
}

function addHistory(data) {
  const x = getActiveInputs(data);
  if (!Number.isFinite(x.price)) return;
  state.history.push({
    t: Date.now(),
    price: x.price,
    target: x.target,
    yesAsk: x.yesAsk,
    noAsk: x.noAsk,
    yesBid: x.yesBid,
    noBid: x.noBid
  });
  state.history = state.history.filter(p => p.t > Date.now() - 1000 * 60 * 90).slice(-900);
  localStorage.setItem('edge15_history_v24', JSON.stringify(state.history));
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

function lastCandlesScore(candles = [], price) {
  if (!candles.length || !price) return { score: 0, label: 'No candle data' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const body = (last.close || 0) - (last.open || 0);
  const range = Math.max(1, (last.high || 0) - (last.low || 0));
  const prevBody = (prev.close || 0) - (prev.open || 0);
  const bodyScore = clamp((body / range) * 8, -8, 8);
  const follow = Math.sign(body) === Math.sign(prevBody) ? Math.sign(body) * 2 : 0;
  return { score: bodyScore + follow, label: `${body >= 0 ? 'Green' : 'Red'} 1m candle, body ${body.toFixed(2)}` };
}

function timeWindow(minutes) {
  if (!Number.isFinite(minutes)) return { label: 'Unknown window', grade: 'warn', risk: 10 };
  if (minutes > 12.5) return { label: 'Very early / forming', grade: 'warn', risk: 8 };
  if (minutes > 8) return { label: 'Early watch zone', grade: 'info', risk: 2 };
  if (minutes > 5) return { label: 'Prime early-entry zone', grade: 'good', risk: -4 };
  if (minutes > 2.25) return { label: 'Late confirmation zone', grade: 'info', risk: 4 };
  if (minutes > 0.75) return { label: 'Danger late zone', grade: 'warn', risk: 18 };
  return { label: 'Expiration danger', grade: 'bad', risk: 28 };
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

  const price = x.price || 0;
  const target = x.target || null;
  const distance = target ? price - target : 0;
  const distPct = target ? (distance / price) * 100 : 0;
  const d15 = delta(price, 15_000);
  const d30 = delta(price, 30_000);
  const d60 = delta(price, 60_000);
  const d180 = delta(price, 180_000);

  const norm = price * 0.00035 || 25;
  const momentumScore =
    tanh(d15 / norm) * 7 +
    tanh(d30 / norm) * 8 +
    tanh(d60 / (norm * 1.3)) * 9 +
    tanh(d180 / (norm * 2.1)) * 7;
  const distanceScore = target ? tanh(distance / (price * 0.0011)) * 23 : 0;
  const candle = lastCandlesScore(data?.coinbase?.candles || [], price);
  const cbBookScore = clamp((data?.coinbase?.book?.imbalance || 0) / 6, -9, 9);
  const kalshiPressureScore = clamp((x.orderbook?.pressure || 0) / 7, -12, 12);
  const oddsMoveScore = clamp((oddsDelta('YES', 60_000) - oddsDelta('NO', 60_000)) * 1.2, -10, 10);
  const futuresScore = clamp((data?.binance?.priceChangePercent24h || 0) / 2.5, -5, 5);

  const rawScore = momentumScore + distanceScore + candle.score + cbBookScore + kalshiPressureScore + oddsMoveScore + futuresScore;
  const score = clamp(rawScore, -48, 48);
  const upProb = clamp(50 + score, 4, 96);
  const downProb = 100 - upProb;
  const direction = upProb >= downProb ? 'YES' : 'NO';
  const directionLabel = direction === 'YES' ? 'UP / YES' : 'DOWN / NO';
  const confidence = direction === 'YES' ? upProb : downProb;
  const currentAsk = direction === 'YES' ? x.yesAsk : x.noAsk;
  const fairPrice = confidence * 0.99;
  const selectedProfile = $('profileSelect').value || 'Balanced';
  const safety = profiles[selectedProfile]?.safety ?? 4;
  const maxBuy = fairPrice - safety;
  const edge = Number.isFinite(currentAsk) ? fairPrice - currentAsk : null;

  const spreadYes = Number.isFinite(x.yesAsk) && Number.isFinite(x.yesBid) ? x.yesAsk - x.yesBid : null;
  const spreadNo = Number.isFinite(x.noAsk) && Number.isFinite(x.noBid) ? x.noAsk - x.noBid : null;
  const activeSpread = direction === 'YES' ? spreadYes : spreadNo;
  const volIndex = data?.deribit?.volatilityIndex ?? null;
  const funding = data?.binance?.latestFundingRate ?? null;

  const whipsaw = Math.sign(d15) && Math.sign(d60) && Math.sign(d15) !== Math.sign(d60);
  const closeToTarget = target ? Math.abs(distPct) < 0.035 : true;
  let risk = 34;
  risk += timeWindow(x.minutesRemaining).risk;
  risk += Math.abs(score) < 14 ? 18 : Math.abs(score) < 22 ? 8 : -4;
  risk += closeToTarget ? 18 : 0;
  risk += whipsaw ? 14 : 0;
  risk += Number.isFinite(activeSpread) && activeSpread > 8 ? 12 : 0;
  risk += Number.isFinite(volIndex) && volIndex > 65 ? 8 : 0;
  risk += Number.isFinite(funding) && Math.abs(funding) > 0.00018 ? 5 : 0;
  risk += edge !== null && edge < 0 ? 10 : 0;
  risk = clamp(Math.round(risk), 1, 99);

  signalRows.push(['BTC micro momentum', `${d15 >= 0 ? '+' : ''}${d15.toFixed(2)} / 15s, ${d60 >= 0 ? '+' : ''}${d60.toFixed(2)} / 60s`]);
  signalRows.push(['Distance signal', target ? `${distance >= 0 ? 'Above' : 'Below'} target by ${fmtUsd(Math.abs(distance))}` : 'Missing target']);
  signalRows.push(['Coinbase orderbook', `${(data?.coinbase?.book?.imbalance ?? 0).toFixed(1)}% imbalance`]);
  signalRows.push(['Kalshi pressure', `${(x.orderbook?.pressure ?? 0).toFixed(1)}% YES-vs-NO depth`]);
  signalRows.push(['Kalshi odds movement', `${oddsMoveScore >= 0 ? 'YES' : 'NO'} ${Math.abs(oddsMoveScore).toFixed(1)} score`]);
  signalRows.push(['1m candle read', candle.label]);

  valueRows.push(['Selected side', directionLabel]);
  valueRows.push(['Estimated chance', `${confidence.toFixed(1)}%`]);
  valueRows.push(['Fair price', fmtC(fairPrice)]);
  valueRows.push(['Safety discount', `${safety.toFixed(1)}¢`]);
  valueRows.push(['Max buy', fmtC(maxBuy)]);
  valueRows.push(['Current ask', Number.isFinite(currentAsk) ? fmtC(currentAsk) : 'Missing']);
  valueRows.push(['Edge', edge !== null ? `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}¢` : 'Missing ask']);

  riskRows.push(['Window', timeWindow(x.minutesRemaining).label]);
  riskRows.push(['Close to target', closeToTarget ? 'Yes - dangerous' : 'No']);
  riskRows.push(['Whipsaw check', whipsaw ? 'Warning' : 'Clean enough']);
  riskRows.push(['Spread', Number.isFinite(activeSpread) ? `${activeSpread.toFixed(1)}¢` : 'Missing']);
  riskRows.push(['Futures funding', Number.isFinite(funding) ? funding.toFixed(6) : 'Unavailable']);
  riskRows.push(['DVOL regime', Number.isFinite(volIndex) ? volIndex.toFixed(2) : 'Unavailable']);

  if (target && price) {
    reasons.push(`${directionLabel} is favored because composite pressure is ${score >= 0 ? 'positive' : 'negative'} and BTC is ${distance >= 0 ? 'above' : 'below'} the target.`);
  }
  if (edge !== null && edge > 0) reasons.push(`Value is positive by ${edge.toFixed(1)}¢ versus Edge15 fair price.`);
  if (edge !== null && edge < 0) warnings.push(`Prediction may be right, but the contract is overpriced by ${Math.abs(edge).toFixed(1)}¢.`);
  if (closeToTarget) warnings.push('BTC is too close to the target; late flips are more likely.');
  if (whipsaw) warnings.push('Short-term momentum disagrees with 1-minute momentum; trap risk is elevated.');

  const profileResults = Object.entries(profiles).map(([name, p]) => {
    const timeOk = Number.isFinite(x.minutesRemaining) ? x.minutesRemaining >= p.minMin && x.minutesRemaining <= p.maxMin : false;
    const scoreOk = Math.abs(score) >= p.score;
    const edgeOk = edge !== null && edge >= p.edge;
    const riskOk = risk <= p.risk;
    const missingOk = Number.isFinite(price) && Number.isFinite(target) && Number.isFinite(currentAsk);
    const take = missingOk && timeOk && scoreOk && edgeOk && riskOk;
    let call = take ? `TAKE ${direction}` : 'SKIP';
    if (!take && missingOk && scoreOk && riskOk && !edgeOk) call = 'WAIT PRICE';
    if (!take && missingOk && Math.abs(score) >= p.score * .72 && timeOk) call = 'WATCH';
    return { name, call, take, timeOk, scoreOk, edgeOk, riskOk };
  });

  const selectedProfileResult = profileResults.find(p => p.name === selectedProfile) || profileResults[0];
  const guardian = profileResults.find(p => p.name === 'No-Trade Guardian');
  const consensusTakes = profileResults.filter(p => p.take && p.name !== 'No-Trade Guardian').length;
  const consensusWatch = profileResults.filter(p => ['TAKE ' + direction, 'WATCH', 'WAIT PRICE'].includes(p.call) && p.name !== 'No-Trade Guardian').length;

  let finalAction = 'SKIP';
  let entryState = 'No edge yet';
  let finalWhy = warnings[0] || 'No clean edge.';

  if (!Number.isFinite(price) || !Number.isFinite(target)) {
    finalAction = 'DATA NEEDED';
    entryState = 'Waiting for target/price';
    finalWhy = 'Add a manual target if Kalshi does not expose it yet.';
  } else if (guardian?.take) {
    finalAction = `TAKE ${direction}`;
    entryState = 'Rare clean guardian-approved entry';
    finalWhy = reasons.join(' ') || 'Strong signal, low risk, positive value.';
  } else if (selectedProfileResult.take && consensusTakes >= 2) {
    finalAction = `TAKE ${direction}`;
    entryState = 'Entry window open';
    finalWhy = reasons.join(' ') || 'Selected profile and consensus agree.';
  } else if (selectedProfileResult.call === 'WAIT PRICE' || (Math.abs(score) >= 20 && edge !== null && edge < (profiles[selectedProfile]?.edge ?? 3))) {
    finalAction = 'WAIT FOR PRICE';
    entryState = `Direction ${direction}, price not good enough`;
    finalWhy = `Direction favors ${directionLabel}, but max buy is ${fmtC(maxBuy)} and current ask is ${fmtC(currentAsk)}.`;
  } else if (consensusWatch >= 2 || Math.abs(score) >= 12) {
    finalAction = 'WATCH DEVELOPING';
    entryState = `${directionLabel} developing`;
    finalWhy = warnings.length ? warnings.join(' ') : `Early signal is forming, but profile/value agreement is not strong enough yet.`;
  }

  if (risk >= 76 && finalAction.startsWith('TAKE')) {
    finalAction = 'SKIP';
    entryState = 'Blocked by risk guard';
    finalWhy = 'Signal exists, but risk guard blocked the entry.';
  }

  entryRows.push(['Best current side', directionLabel]);
  entryRows.push(['Entry status', entryState]);
  entryRows.push(['Best window', 'Target zone: roughly 8:00–5:00 remaining unless signal is unusually clean earlier.']);
  entryRows.push(['Take rule', `Only take ${direction} at ${fmtC(maxBuy)} or better.`]);
  entryRows.push(['Consensus', `${consensusTakes} take / ${consensusWatch} watch-or-better profiles`]);

  return {
    x, score, upProb, downProb, direction, directionLabel, confidence, currentAsk,
    fairPrice, maxBuy, edge, risk, finalAction, entryState, finalWhy,
    reasons, warnings, signalRows, valueRows, riskRows, entryRows, profileResults,
    selectedProfile, distance, distPct, d15, d30, d60, d180
  };
}

function row(label, value, cls = '') {
  return `<div class="row"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

function render() {
  const data = state.latest;
  if (!data) return;
  const d = analyze(data);
  state.decision = d;
  const x = d.x;
  const tw = timeWindow(x.minutesRemaining);

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
  $('scoreRead').textContent = `Score ${d.score.toFixed(1)}`;
  $('scoreBar').style.left = `${clamp(50 + d.score, 2, 98)}%`;
  $('entryState').textContent = d.entryState;
  $('entryState').className = `pill ${d.finalAction.startsWith('TAKE') ? 'good' : d.finalAction.includes('WAIT') || d.finalAction.includes('WATCH') ? 'warn' : 'bad'}`;
  $('marketTicker').textContent = x.market?.ticker || 'No open market found';

  $('profilesTable').innerHTML = d.profileResults.map(p => {
    const active = p.name === d.selectedProfile ? 'active' : '';
    const cls = p.take ? 'goodtext' : p.call === 'WATCH' || p.call === 'WAIT PRICE' ? 'warntext' : 'badtext';
    return `<div class="row ${active}"><div class="profile-name">${p.name}</div><strong class="${cls}">${p.call}</strong></div>`;
  }).join('');

  $('entryDetails').innerHTML = d.entryRows.map(([a,b]) => row(a,b)).join('');
  $('signalBoard').innerHTML = d.signalRows.map(([a,b]) => row(a,b)).join('');
  $('valueBoard').innerHTML = d.valueRows.map(([a,b]) => row(a,b, String(b).startsWith('+') ? 'goodtext' : String(b).startsWith('-') ? 'badtext' : '')).join('');
  $('riskBoard').innerHTML = d.riskRows.map(([a,b]) => row(a,b, String(b).includes('Warning') || String(b).includes('dangerous') ? 'warntext' : '')).join('');

  const sources = [];
  sources.push(['Kalshi', data.kalshi?.market?.ticker ? 'OK - live market found' : 'Issue']);
  sources.push(['BTC spot fallback', data.btc?.price ? `OK - ${data.btc.source || 'source'}` : 'Issue']);
  sources.push(['Coinbase spot/candles/book', data.coinbase?.ok ? 'OK' : 'Issue']);
  sources.push(['Binance futures regime', data.binance?.ok ? 'OK' : 'Issue']);
  sources.push(['Deribit volatility', data.deribit?.ok ? 'OK' : 'Issue']);
  sources.push(['Kalshi YES/NO ask', `YES ${fmtC(x.yesAsk)} / NO ${fmtC(x.noAsk)}`]);
  sources.push(['Fetch mode', data.fetchMode || 'api-all']);
  sources.push(['Kalshi book depth', x.orderbook ? `YES ${Math.round(x.orderbook.yesDepth || 0)} / NO ${Math.round(x.orderbook.noDepth || 0)}` : 'Unavailable']);
  $('dataSources').innerHTML = sources.map(([a,b]) => row(a,b, b === 'OK' ? 'goodtext' : b === 'Issue' ? 'warntext' : '')).join('');

  $('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  updateDiagnostics();
  renderTracker();
}

function updateDiagnostics(extra = null) {
  const payload = {
    lastDecision: state.decision ? {
      action: state.decision.finalAction,
      direction: state.decision.directionLabel,
      confidence: state.decision.confidence,
      risk: state.decision.risk,
      fairPrice: state.decision.fairPrice,
      maxBuy: state.decision.maxBuy,
      currentAsk: state.decision.currentAsk,
      score: state.decision.score,
      profile: state.decision.selectedProfile,
      reason: state.decision.finalWhy
    } : null,
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
    // Browser-direct endpoint calls are now the primary path. This avoids a Vercel self-fetch issue
    // where /api/all can return a successful wrapper but stale/missing nested payloads.
    let data = await directDataFetch();

    // Keep /api/all as a diagnostic cross-check only; never allow it to blank out good direct data.
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
  if (path.includes('kalshi')) return { market: json.market?.ticker, target: json.market?.target, candidates: json.candidates?.length, diagnostics: json.diagnostics?.slice?.(0, 3) };
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
    result,
    profile: d.selectedProfile,
    action: d.finalAction,
    direction: d.direction,
    confidence: Number(d.confidence.toFixed(2)),
    risk: d.risk,
    score: Number(d.score.toFixed(2)),
    fairPrice: Number(d.fairPrice.toFixed(2)),
    maxBuy: Number(d.maxBuy.toFixed(2)),
    currentAsk: Number.isFinite(d.currentAsk) ? Number(d.currentAsk.toFixed(2)) : null,
    edge: d.edge !== null ? Number(d.edge.toFixed(2)) : null,
    btcPrice: x.price,
    target: x.target,
    distance: Number(d.distance.toFixed(2)),
    minutesRemaining: Number.isFinite(x.minutesRemaining) ? Number(x.minutesRemaining.toFixed(2)) : null,
    marketTicker: x.market?.ticker || null,
    reason: d.finalWhy
  };
  state.logs.unshift(item);
  state.logs = state.logs.slice(0, 2000);
  localStorage.setItem('edge15_logs_v24', JSON.stringify(state.logs));
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
    ['Wins', wins], ['Losses', losses], ['No-trades', noTrades], ['Win rate', scored ? `${wr.toFixed(1)}%` : '--']
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
  const logs = state.logs;
  if (!logs.length) return;
  const keys = Object.keys(logs[0]);
  const csv = [keys.join(','), ...logs.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n');
  download(`edge15-results-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
}

function exportJson() {
  download(`edge15-results-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state.logs, null, 2), 'application/json');
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
    if (confirm('Clear Edge15 local result logs?')) {
      state.logs = [];
      localStorage.removeItem('edge15_logs_v24');
      renderTracker();
    }
  });
}

bind();
renderTracker();
refresh();
state.interval = setInterval(refresh, 5000);
