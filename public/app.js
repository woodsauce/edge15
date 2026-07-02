const $ = id => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const tanh = Math.tanh;
const fmtUsd = n => Number.isFinite(n) ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '--';
const fmtC = n => Number.isFinite(n) ? `${Math.round(n * 10) / 10}¢` : '--';
const fmtMin = m => Number.isFinite(m) ? `${Math.floor(m)}:${String(Math.max(0, Math.floor((m % 1) * 60))).padStart(2, '0')}` : '--';

const state = {
  paused: false,
  latest: null,
  decision: null,
  interval: null,
  history: JSON.parse(localStorage.getItem('edge15_history_v28') || '[]'),
  logs: JSON.parse(localStorage.getItem('edge15_logs_v28') || '[]'),
  snapshots: JSON.parse(localStorage.getItem('edge15_430_snapshots_v28') || '[]'),
  cachedCandles: [],
  lastCandlesFetch: 0
};

const modes = {
  '430 Decision': { label: '4:30 Decision', minScore: 23, minEdge: 1.5, maxRisk: 70, safety: 4.8, allowOutside: false },
  'Balanced': { label: 'Balanced', minScore: 20, minEdge: 2.2, maxRisk: 72, safety: 4.2, allowOutside: true },
  'Aggressive': { label: 'Aggressive', minScore: 17, minEdge: 0.5, maxRisk: 79, safety: 3.0, allowOutside: true },
  'Conservative': { label: 'Conservative', minScore: 29, minEdge: 4.0, maxRisk: 58, safety: 6.5, allowOutside: true },
  'Paper Only': { label: 'Paper Only', minScore: 12, minEdge: -8, maxRisk: 99, safety: 0, allowOutside: true }
};

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function manualNumber(id) {
  const el = $(id);
  const n = el ? Number(el.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function activeInputs(data) {
  const market = data?.kalshi?.market || null;
  const orderbook = data?.kalshi?.orderbook || null;
  const price = manualNumber('manualPrice') ?? data?.btc?.price ?? data?.coinbase?.price ?? data?.binance?.markPrice ?? null;
  const target = manualNumber('manualTarget') ?? market?.target ?? null;
  const yesAsk = manualNumber('manualYesAsk') ?? market?.yesAsk ?? orderbook?.impliedYesAsk ?? null;
  const noAsk = manualNumber('manualNoAsk') ?? market?.noAsk ?? orderbook?.impliedNoAsk ?? null;
  const yesBid = market?.yesBid ?? orderbook?.bestYesBid ?? null;
  const noBid = market?.noBid ?? orderbook?.bestNoBid ?? null;
  const close = market?.closeTime ? Date.parse(market.closeTime) : null;
  const liveMinutes = close ? Math.max(0, (close - Date.now()) / 60000) : null;
  const minutesRemaining = manualNumber('manualMinutes') ?? liveMinutes;
  return { market, orderbook, price, target, yesAsk, noAsk, yesBid, noBid, close, minutesRemaining };
}

function addHistory(data) {
  const x = activeInputs(data);
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
  state.history = state.history.filter(p => p.t > Date.now() - 90 * 60 * 1000).slice(-1200);
  localStorage.setItem('edge15_history_v28', JSON.stringify(state.history));
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

function priceDelta(price, ms) {
  const p = pointAgo(ms);
  return p?.price ? price - p.price : 0;
}

function askDelta(side, ms) {
  const p = pointAgo(ms);
  const c = state.history[state.history.length - 1];
  if (!p || !c) return 0;
  const key = side === 'YES' ? 'yesAsk' : 'noAsk';
  if (!Number.isFinite(c[key]) || !Number.isFinite(p[key])) return 0;
  return c[key] - p[key];
}

function windowRead(minutes) {
  if (!Number.isFinite(minutes)) return { label: 'Unknown time', status: 'DATA NEEDED', cls: 'warn', risk: 12, in430: false, stage: 'unknown' };
  if (minutes > 10) return { label: 'Too early for 4:30 model', status: 'STAGING', cls: 'neutral', risk: 10, in430: false, stage: 'too_early' };
  if (minutes > 5) return { label: 'Pre-decision staging', status: 'STAGING', cls: 'info', risk: 2, in430: false, stage: 'staging' };
  if (minutes >= 4) return { label: 'LIVE 5:00–4:00 decision window', status: 'DECIDE NOW', cls: 'good', risk: -6, in430: true, stage: 'decision' };
  if (minutes >= 2.5) return { label: 'After decision window / late risk', status: 'LATE', cls: 'warn', risk: 9, in430: false, stage: 'late' };
  if (minutes >= 0.75) return { label: 'Danger late zone', status: 'DANGER', cls: 'bad', risk: 22, in430: false, stage: 'danger' };
  return { label: 'Expiration danger', status: 'NO NEW ENTRY', cls: 'bad', risk: 35, in430: false, stage: 'expiration' };
}

function candleScore(candles = []) {
  if (!Array.isArray(candles) || candles.length < 2) return { score: 0, label: 'No candle confirmation' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = num(last.close, 0) - num(last.open, 0);
  const prevBody = num(prev.close, 0) - num(prev.open, 0);
  const range = Math.max(1, num(last.high, 0) - num(last.low, 0));
  const bodyScore = clamp((body / range) * 8, -8, 8);
  const follow = Math.sign(body) === Math.sign(prevBody) ? Math.sign(body) * 2 : -Math.sign(prevBody) * 1.5;
  return { score: bodyScore + follow, label: `${body >= 0 ? 'Green' : 'Red'} 1m candle, body ${body.toFixed(2)}` };
}

function tradePressure(trades = []) {
  let yes = 0;
  let no = 0;
  const cutoff = Date.now() - 45_000;
  for (const t of trades || []) {
    const ts = Date.parse(t.created_time || t.time || 0);
    if (Number.isFinite(ts) && ts < cutoff) continue;
    const count = num(t.count_fp ?? t.count, 1) || 1;
    const side = String(t.taker_side || t.taker_outcome_side || '').toLowerCase();
    if (side === 'yes') yes += count;
    if (side === 'no') no += count;
  }
  const total = yes + no;
  const pressure = total ? ((yes - no) / total) * 100 : 0;
  return { yes, no, pressure, label: total ? `${Math.round(pressure)}% ${pressure >= 0 ? 'YES' : 'NO'} recent trade pressure` : 'No recent trade pressure' };
}

function analyze(data) {
  const x = activeInputs(data);
  const modeName = $('modeSelect')?.value || '430 Decision';
  const mode = modes[modeName] || modes['430 Decision'];
  const wr = windowRead(x.minutesRemaining);
  const reasons = [];
  const warnings = [];
  const signals = [];
  const checks = [];

  if (!Number.isFinite(x.price)) warnings.push('BTC price missing. Live BTC endpoint or manual price needed.');
  if (!Number.isFinite(x.target)) warnings.push('Kalshi target missing. Live Kalshi target or manual target needed.');

  const price = x.price || 0;
  const target = x.target || null;
  const distance = target ? price - target : 0;
  const distPct = target && price ? (distance / price) * 100 : 0;
  const d15 = priceDelta(price, 15_000);
  const d30 = priceDelta(price, 30_000);
  const d60 = priceDelta(price, 60_000);
  const d180 = priceDelta(price, 180_000);
  const d300 = priceDelta(price, 300_000);
  const base = Math.max(18, price * 0.00032);

  const microMomentum = tanh(d15 / base) * 7 + tanh(d30 / base) * 8 + tanh(d60 / (base * 1.25)) * 8;
  const fiveMinuteMomentum = tanh(d300 / (base * 2.5)) * 7 + tanh(d180 / (base * 2.0)) * 5;
  const distanceScore = target ? tanh(distance / (price * 0.00095)) * 24 : 0;
  const candle = candleScore(data?.coinbase?.candles || []);
  const coinbaseBook = clamp((data?.coinbase?.book?.imbalance || 0) / 6, -8, 8);
  const kalshiBook = clamp((x.orderbook?.pressure || 0) / 3.5, -10, 10);
  const trades = tradePressure(data?.kalshi?.trades || []);
  const tradeScore = clamp(trades.pressure / 7, -9, 9);
  const oddsScore = clamp((askDelta('YES', 60_000) - askDelta('NO', 60_000)) * 1.4, -8, 8);
  const futuresScore = clamp((data?.binance?.priceChangePercent24h || 0) / 2.75, -5, 5);
  const vol = num(data?.deribit?.volatilityIndex, null);
  const volPenalty = Number.isFinite(vol) && vol > 70 ? 3 : 0;

  const rawScore = microMomentum + fiveMinuteMomentum + distanceScore + candle.score + coinbaseBook + kalshiBook + tradeScore + oddsScore + futuresScore;
  const score = clamp(rawScore, -48, 48);
  const yesProb = clamp(50 + score, 3, 97);
  const noProb = 100 - yesProb;
  const direction = yesProb >= noProb ? 'YES' : 'NO';
  const directionLabel = direction === 'YES' ? 'YES / OVER' : 'NO / UNDER';
  const confidence = direction === 'YES' ? yesProb : noProb;
  const currentAsk = direction === 'YES' ? x.yesAsk : x.noAsk;
  const fairPrice = clamp(confidence - 1.0, 1, 99);
  const maxBuy = clamp(fairPrice - mode.safety, 1, 99);
  const edge = Number.isFinite(currentAsk) ? fairPrice - currentAsk : null;

  const spread = direction === 'YES'
    ? (Number.isFinite(x.yesAsk) && Number.isFinite(x.yesBid) ? x.yesAsk - x.yesBid : null)
    : (Number.isFinite(x.noAsk) && Number.isFinite(x.noBid) ? x.noAsk - x.noBid : null);
  const closeToTarget = target ? Math.abs(distPct) < 0.035 : true;
  const whipsaw = Math.sign(d15) && Math.sign(d60) && Math.sign(d15) !== Math.sign(d60);
  const funding = num(data?.binance?.latestFundingRate, null);

  let risk = 34 + wr.risk + volPenalty;
  risk += Math.abs(score) < 13 ? 18 : Math.abs(score) < 22 ? 8 : -4;
  risk += closeToTarget ? 15 : 0;
  risk += whipsaw ? 13 : 0;
  risk += Number.isFinite(spread) && spread > 6 ? 8 : 0;
  risk += Number.isFinite(edge) && edge < 0 ? 8 : 0;
  risk += Number.isFinite(funding) && Math.abs(funding) > 0.00018 ? 4 : 0;
  risk = clamp(Math.round(risk), 1, 99);

  const strongSignal = Math.abs(score) >= mode.minScore;
  const valueOk = edge !== null && edge >= mode.minEdge;
  const riskOk = risk <= mode.maxRisk;
  const dataOk = Number.isFinite(price) && Number.isFinite(target) && Number.isFinite(currentAsk);
  const windowOk = mode.allowOutside || wr.in430;
  const paperOnly = modeName === 'Paper Only';

  let finalAction = 'DATA NEEDED';
  let finalWhy = warnings[0] || 'Waiting for usable live data.';
  let tradeState = 'blocked';

  if (dataOk) {
    if (!windowOk && wr.stage === 'staging') {
      finalAction = `STAGING ${direction}`;
      finalWhy = `Lean is ${directionLabel}, but Genesis 28 is waiting for the 5:00–4:00 decision window.`;
      tradeState = 'staging';
    } else if (!windowOk && ['late','danger','expiration'].includes(wr.stage)) {
      finalAction = `LATE ${direction} / PAPER ONLY`;
      finalWhy = `The model already passed its target decision window. Treat this as tracking unless the setup is exceptional.`;
      tradeState = 'late';
    } else if (!strongSignal) {
      finalAction = `LEAN ${direction}`;
      finalWhy = `Direction favors ${directionLabel}, but signal strength is not high enough for a trade.`;
      tradeState = 'lean';
    } else if (!valueOk) {
      finalAction = `WAIT PRICE ${direction}`;
      finalWhy = `${directionLabel} is favored, but current ask is ${fmtC(currentAsk)} and max buy is ${fmtC(maxBuy)}.`;
      tradeState = 'wait';
    } else if (!riskOk) {
      finalAction = `SKIP / RISK ${direction}`;
      finalWhy = `${directionLabel} has signal/value, but risk guard is too high at ${risk}/100.`;
      tradeState = 'risk';
    } else if (paperOnly) {
      finalAction = `PAPER ${direction}`;
      finalWhy = `Paper-only mode: ${directionLabel} qualifies, but this mode does not label live trades.`;
      tradeState = 'paper';
    } else {
      finalAction = `TAKE ${direction}`;
      finalWhy = `${directionLabel} qualifies inside the decision rules. Only take it at ${fmtC(maxBuy)} or better.`;
      tradeState = 'take';
    }
  }

  if (warnings.length && finalAction !== 'DATA NEEDED') finalWhy = `${finalWhy} Warning: ${warnings.join(' ')}`;

  reasons.push(['Direction', `${directionLabel} at ${confidence.toFixed(1)}% estimated chance`]);
  reasons.push(['BTC vs target', target ? `${distance >= 0 ? 'Above' : 'Below'} by ${fmtUsd(Math.abs(distance))}` : 'Target missing']);
  reasons.push(['Momentum', `${d15 >= 0 ? '+' : ''}${d15.toFixed(2)} / 15s, ${d60 >= 0 ? '+' : ''}${d60.toFixed(2)} / 60s, ${d300 >= 0 ? '+' : ''}${d300.toFixed(2)} / 5m`]);
  reasons.push(['Market pressure', `${trades.label}; book ${(x.orderbook?.pressure ?? 0).toFixed(1)}%`]);
  reasons.push(['Window', wr.label]);

  checks.push(['Current ask', fmtC(currentAsk)]);
  checks.push(['Fair price', fmtC(fairPrice)]);
  checks.push(['Max buy', fmtC(maxBuy)]);
  checks.push(['Value edge', edge !== null ? `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}¢` : 'Missing ask']);
  checks.push(['Risk guard', `${risk}/100`]);
  checks.push(['Spread', Number.isFinite(spread) ? `${spread.toFixed(1)}¢` : 'Missing']);

  signals.push(['Composite score', score.toFixed(1)]);
  signals.push(['Micro momentum', microMomentum.toFixed(1)]);
  signals.push(['5m momentum', fiveMinuteMomentum.toFixed(1)]);
  signals.push(['Distance score', distanceScore.toFixed(1)]);
  signals.push(['Coinbase candle', `${candle.score.toFixed(1)} — ${candle.label}`]);
  signals.push(['Coinbase book', `${coinbaseBook.toFixed(1)} from ${(data?.coinbase?.book?.imbalance ?? 0).toFixed(1)}% imbalance`]);
  signals.push(['Kalshi book', `${kalshiBook.toFixed(1)} from ${(x.orderbook?.pressure ?? 0).toFixed(1)}% depth pressure`]);
  signals.push(['Kalshi trades', `${tradeScore.toFixed(1)} from ${trades.label}`]);
  signals.push(['Kalshi odds move', oddsScore.toFixed(1)]);
  signals.push(['Binance futures', `${futuresScore.toFixed(1)}; funding ${Number.isFinite(funding) ? funding.toFixed(6) : 'n/a'}`]);
  signals.push(['Deribit DVOL', Number.isFinite(vol) ? vol.toFixed(2) : 'n/a']);
  signals.push(['Whipsaw', whipsaw ? 'Warning' : 'Clean enough']);
  signals.push(['Close to target', closeToTarget ? 'Yes' : 'No']);

  const modeResults = Object.entries(modes).map(([name, m]) => {
    const okWindow = m.allowOutside || wr.in430;
    const take = dataOk && okWindow && Math.abs(score) >= m.minScore && (edge ?? -99) >= m.minEdge && risk <= m.maxRisk && name !== 'Paper Only';
    let call = 'SKIP';
    if (!dataOk) call = 'DATA';
    else if (!okWindow && wr.stage === 'staging') call = `STAGE ${direction}`;
    else if (!okWindow) call = `LATE ${direction}`;
    else if (take) call = `TAKE ${direction}`;
    else if (Math.abs(score) >= m.minScore && (edge ?? -99) < m.minEdge) call = `WAIT ${direction}`;
    else if (Math.abs(score) >= 12) call = `LEAN ${direction}`;
    if (name === 'Paper Only' && dataOk) call = `PAPER ${direction}`;
    return { name, call, take };
  });

  return {
    x, modeName, mode, wr, score, yesProb, noProb, direction, directionLabel, confidence,
    currentAsk, fairPrice, maxBuy, edge, risk, spread, closeToTarget, whipsaw,
    finalAction, finalWhy, tradeState, reasons, checks, signals, modeResults,
    distance, distPct, d15, d30, d60, d180, d300, dataOk, strongSignal, valueOk, riskOk
  };
}

function row(label, value, cls = '') {
  return `<div class="item"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

function classForValue(text) {
  const s = String(text);
  if (s.includes('TAKE') || s.startsWith('+') || s.includes('Clean')) return 'goodtext';
  if (s.includes('WAIT') || s.includes('Warning') || s.includes('STAGE') || s.includes('LATE')) return 'warntext';
  if (s.includes('SKIP') || s.includes('Missing') || s.includes('DATA') || s.startsWith('-')) return 'badtext';
  return '';
}

function setPill(id, text, cls = 'muted') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${cls}`;
}

function render() {
  if (!state.latest) return;
  const d = analyze(state.latest);
  state.decision = d;
  const x = d.x;

  $('finalAction').textContent = d.finalAction;
  $('finalWhy').textContent = d.finalWhy;
  $('leanRead').textContent = d.directionLabel;
  $('confidenceRead').textContent = `${d.confidence.toFixed(1)}%`;
  $('riskRead').textContent = `${d.risk}/100`;
  $('riskRead').className = d.risk <= 55 ? 'goodtext' : d.risk <= 72 ? 'warntext' : 'badtext';
  $('maxBuyRead').textContent = fmtC(d.maxBuy);
  $('currentAskRead').textContent = fmtC(d.currentAsk);
  $('fairPriceRead').textContent = `Fair ${fmtC(d.fairPrice)}`;
  $('valueRead').textContent = d.edge !== null ? `Edge ${d.edge >= 0 ? '+' : ''}${d.edge.toFixed(1)}¢` : 'Edge --';
  $('valueRead').className = d.edge !== null && d.edge >= 0 ? 'goodtext' : d.edge !== null ? 'badtext' : '';

  $('btcPrice').textContent = fmtUsd(x.price);
  $('btcMeta').textContent = state.latest?.btc?.source ? `${state.latest.btc.source} ${state.latest.btc.time ? new Date(state.latest.btc.time).toLocaleTimeString() : ''}` : 'BTC source';
  $('targetPrice').textContent = fmtUsd(x.target);
  $('marketTicker').textContent = x.market?.ticker || 'No open market found';
  $('timeRemaining').textContent = fmtMin(x.minutesRemaining);
  $('windowLabel').textContent = d.wr.label;
  $('distanceRead').textContent = x.target ? `${d.distance >= 0 ? '+' : '-'}${fmtUsd(Math.abs(d.distance))}` : '--';
  $('distanceMeta').textContent = x.target ? `${d.distPct >= 0 ? '+' : ''}${d.distPct.toFixed(3)}% from target` : '--';

  setPill('windowPill', d.wr.status, d.wr.cls);
  setPill('modePill', modes[d.modeName]?.label || d.modeName, d.modeName === '430 Decision' ? 'info' : 'muted');
  setPill('dataPill', d.dataOk ? 'Live data OK' : 'Data needed', d.dataOk ? 'good' : 'bad');
  setPill('signalPill', `Score ${d.score.toFixed(1)}`, Math.abs(d.score) >= d.mode.minScore ? 'good' : 'warn');
  setPill('tradePill', d.tradeState.toUpperCase(), d.tradeState === 'take' ? 'good' : ['wait','staging','late','paper'].includes(d.tradeState) ? 'warn' : 'bad');
  setPill('windowStatus', d.wr.status, d.wr.cls);

  $('simpleReasons').innerHTML = d.reasons.map(([a,b]) => row(a,b,classForValue(b))).join('');
  $('tradeChecklist').innerHTML = d.checks.map(([a,b]) => row(a,b,classForValue(b))).join('');
  $('advancedSignals').innerHTML = d.signals.map(([a,b]) => row(a,b,classForValue(b))).join('');
  $('modeTable').innerHTML = d.modeResults.map(m => row(m.name, m.call, classForValue(m.call))).join('');

  $('windowDetails').innerHTML = [
    ['Target window', '5:00–4:00 left'],
    ['Current window', d.wr.label],
    ['Decision rule', d.wr.in430 ? 'DECIDE NOW' : d.wr.stage === 'staging' ? 'Stage only' : 'Late / paper only'],
    ['Take rule', `Only ${d.direction} at ${fmtC(d.maxBuy)} or better`]
  ].map(([a,b]) => `<div class="windowBox"><span>${a}</span><strong class="${classForValue(b)}">${b}</strong></div>`).join('');

  const sources = [
    ['Kalshi market', state.latest?.kalshi?.market?.ticker ? 'OK - active market' : 'Issue'],
    ['Kalshi orderbook', state.latest?.kalshi?.orderbook ? 'OK - book present' : 'Issue'],
    ['Kalshi trades', Array.isArray(state.latest?.kalshi?.trades) ? `${state.latest.kalshi.trades.length} recent trades` : 'Issue'],
    ['BTC spot', state.latest?.btc?.price ? `OK - ${state.latest.btc.source || 'source'}` : 'Issue'],
    ['Coinbase book', state.latest?.coinbase?.book ? 'OK' : 'Issue'],
    ['Coinbase candles', state.latest?.coinbase?.candles?.length ? `${state.latest.coinbase.candles.length} candles` : 'Issue'],
    ['Binance regime', state.latest?.binance?.ok ? 'OK' : 'Issue'],
    ['Deribit volatility', state.latest?.deribit?.ok ? 'OK' : 'Issue'],
    ['YES / NO ask', `YES ${fmtC(x.yesAsk)} / NO ${fmtC(x.noAsk)}`],
    ['Fetch mode', state.latest?.fetchMode || 'direct']
  ];
  $('dataSources').innerHTML = sources.map(([a,b]) => row(a,b,classForValue(b))).join('');

  maybeSaveSnapshot(d);
  updateDiagnostics();
  renderTracker();
  $('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function maybeSaveSnapshot(d) {
  if (!d.wr.in430 || !d.x.market?.ticker || !d.dataOk) return;
  const key = `${d.x.market.ticker}|430`;
  if (state.snapshots.some(s => s.key === key)) return;
  const snap = {
    key,
    savedAt: new Date().toISOString(),
    ticker: d.x.market.ticker,
    minutesRemaining: Number(d.x.minutesRemaining.toFixed(2)),
    action: d.finalAction,
    direction: d.direction,
    confidence: Number(d.confidence.toFixed(2)),
    risk: d.risk,
    score: Number(d.score.toFixed(2)),
    fairPrice: Number(d.fairPrice.toFixed(2)),
    maxBuy: Number(d.maxBuy.toFixed(2)),
    currentAsk: Number.isFinite(d.currentAsk) ? Number(d.currentAsk.toFixed(2)) : null,
    edge: d.edge !== null ? Number(d.edge.toFixed(2)) : null,
    btcPrice: d.x.price,
    target: d.x.target,
    reason: d.finalWhy
  };
  state.snapshots.unshift(snap);
  state.snapshots = state.snapshots.slice(0, 500);
  localStorage.setItem('edge15_430_snapshots_v28', JSON.stringify(state.snapshots));
}

function updateDiagnostics(extra = null) {
  const payload = {
    version: 'Genesis-028 Classic 4:30 Decision',
    latestDecision: state.decision ? {
      action: state.decision.finalAction,
      direction: state.decision.directionLabel,
      confidence: state.decision.confidence,
      risk: state.decision.risk,
      score: state.decision.score,
      fairPrice: state.decision.fairPrice,
      maxBuy: state.decision.maxBuy,
      currentAsk: state.decision.currentAsk,
      edge: state.decision.edge,
      window: state.decision.wr.label,
      mode: state.decision.modeName
    } : null,
    endpointErrors: state.latest?.endpointErrors || [],
    allEndpoint: state.latest?.allEndpoint || null,
    extra
  };
  $('diagnostics').textContent = JSON.stringify(payload, null, 2);
}

async function getJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${path}${sep}_=${Date.now()}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

function settled(result, fallback) {
  return result.status === 'fulfilled' ? result.value : fallback;
}

async function directFetch() {
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
    fetchMode: 'direct-live-endpoints',
    kalshi: settled(kalshi, { ok: false, error: String(kalshi.reason) }),
    btc: settled(btc, { ok: false, error: String(btc.reason) }),
    coinbase: settled(coinbase, { ok: false, error: String(coinbase.reason) }),
    binance: settled(binance, { ok: false, error: String(binance.reason) }),
    deribit: settled(deribit, { ok: false, error: String(deribit.reason) }),
    endpointErrors: [
      kalshi.status === 'rejected' ? { source: 'kalshi', error: String(kalshi.reason) } : null,
      btc.status === 'rejected' ? { source: 'btc', error: String(btc.reason) } : null,
      coinbase.status === 'rejected' ? { source: 'coinbase', error: String(coinbase.reason) } : null,
      binance.status === 'rejected' ? { source: 'binance', error: String(binance.reason) } : null,
      deribit.status === 'rejected' ? { source: 'deribit', error: String(deribit.reason) } : null
    ].filter(Boolean)
  };
}

function hasLiveCore(data) {
  return Boolean(data?.btc?.price && data?.kalshi?.market?.ticker);
}

async function refresh() {
  if (state.paused) return;
  try {
    let data = await directFetch();
    try {
      const all = await getJson('/api/all');
      data.allEndpoint = { ok: all.ok !== false, hasBtc: Boolean(all?.btc?.price), hasKalshi: Boolean(all?.kalshi?.market?.ticker), errors: all.errors || [] };
      if (!hasLiveCore(data) && hasLiveCore(all)) data = { ...all, fetchMode: 'api-all-fallback', allEndpoint: data.allEndpoint };
    } catch (err) {
      data.allEndpoint = { ok: false, error: String(err) };
    }

    if (!state.cachedCandles.length || Date.now() - state.lastCandlesFetch > 60_000) {
      try {
        const candles = await getJson('/api/candles?minutes=120');
        state.cachedCandles = candles.candles || [];
        state.lastCandlesFetch = Date.now();
      } catch (err) {
        data.candleEndpointError = String(err);
      }
    }
    data.coinbase = data.coinbase || {};
    data.coinbase.candles = state.cachedCandles;
    state.latest = data;
    addHistory(data);
    render();
  } catch (err) {
    updateDiagnostics({ refreshError: String(err) });
  }
}

async function runApiTest() {
  const paths = ['/api/health', '/api/kalshi?series=KXBTC15M', '/api/btc', '/api/coinbase?light=1', '/api/candles?minutes=30', '/api/binance', '/api/deribit', '/api/all'];
  const results = [];
  for (const path of paths) {
    const started = performance.now();
    try {
      const json = await getJson(path);
      results.push({ path, ok: json.ok !== false, ms: Math.round(performance.now() - started), summary: summarize(path, json) });
    } catch (err) {
      results.push({ path, ok: false, ms: Math.round(performance.now() - started), error: String(err) });
    }
  }
  updateDiagnostics({ apiTest: results });
}

function summarize(path, json) {
  if (path.includes('kalshi')) return { market: json.market?.ticker, target: json.market?.target, yesAsk: json.market?.yesAsk, noAsk: json.market?.noAsk, trades: json.trades?.length };
  if (path.includes('btc')) return { price: json.price, source: json.source, bid: json.bid, ask: json.ask };
  if (path.includes('coinbase')) return { price: json.price, book: Boolean(json.book), candles: json.candles?.length };
  if (path.includes('candles')) return { candles: json.candles?.length };
  if (path.includes('binance')) return { funding: json.latestFundingRate, openInterest: json.openInterest, change: json.priceChangePercent24h };
  if (path.includes('deribit')) return { volatilityIndex: json.volatilityIndex, points: json.points?.length };
  if (path.includes('all')) return { hasBtc: Boolean(json.btc?.price), hasKalshi: Boolean(json.kalshi?.market?.ticker) };
  return json;
}

function logResult(result) {
  if (!state.decision) return;
  const d = state.decision;
  const item = {
    loggedAt: new Date().toISOString(),
    result,
    mode: d.modeName,
    action: d.finalAction,
    direction: d.direction,
    confidence: Number(d.confidence.toFixed(2)),
    risk: d.risk,
    score: Number(d.score.toFixed(2)),
    fairPrice: Number(d.fairPrice.toFixed(2)),
    maxBuy: Number(d.maxBuy.toFixed(2)),
    currentAsk: Number.isFinite(d.currentAsk) ? Number(d.currentAsk.toFixed(2)) : null,
    edge: d.edge !== null ? Number(d.edge.toFixed(2)) : null,
    btcPrice: d.x.price,
    target: d.x.target,
    distance: Number(d.distance.toFixed(2)),
    minutesRemaining: Number.isFinite(d.x.minutesRemaining) ? Number(d.x.minutesRemaining.toFixed(2)) : null,
    marketTicker: d.x.market?.ticker || null,
    reason: d.finalWhy
  };
  state.logs.unshift(item);
  state.logs = state.logs.slice(0, 3000);
  localStorage.setItem('edge15_logs_v28', JSON.stringify(state.logs));
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
  const combined = state.logs.map(x => ({ kind: 'result', ...x })).concat(state.snapshots.map(x => ({ kind: '430_snapshot', ...x })));
  if (!combined.length) return;
  const keys = Array.from(new Set(combined.flatMap(x => Object.keys(x))));
  const csv = [keys.join(','), ...combined.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
  download(`edge15-genesis-028-results-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv');
}

function exportJson() {
  download(`edge15-genesis-028-results-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ logs: state.logs, snapshots430: state.snapshots }, null, 2), 'application/json');
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
  $('modeSelect').addEventListener('change', render);
  ['manualTarget','manualPrice','manualYesAsk','manualNoAsk','manualMinutes'].forEach(id => $(id).addEventListener('input', render));
  $('logWinBtn').addEventListener('click', () => logResult('WIN'));
  $('logLossBtn').addEventListener('click', () => logResult('LOSS'));
  $('logNoTradeBtn').addEventListener('click', () => logResult('NO_TRADE'));
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('clearLogsBtn').addEventListener('click', () => {
    if (confirm('Clear local Edge15 Genesis-028 result logs and snapshots?')) {
      state.logs = [];
      state.snapshots = [];
      localStorage.removeItem('edge15_logs_v28');
      localStorage.removeItem('edge15_430_snapshots_v28');
      renderTracker();
    }
  });
}

bind();
renderTracker();
refresh();
state.interval = setInterval(refresh, 5000);
