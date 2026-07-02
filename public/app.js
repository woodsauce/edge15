const $ = id => document.getElementById(id);
const fmtUsd = n => Number.isFinite(n) ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--';
const fmtPct = n => Number.isFinite(n) ? n.toFixed(0) + '%' : '--';
const fmtCents = n => Number.isFinite(n) ? n.toFixed(n % 1 ? 1 : 0) + '¢' : '--';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const cleanNum = s => {
  if (s === null || s === undefined || s === '') return NaN;
  return parseFloat(String(s).replace(/[$,%¢,\s]/g, '').replace(/[^\d.-]/g, ''));
};

let selectedImage = null;
let live = {
  btc: null,
  kalshi: null,
  coinbase: null,
  candles: [],
  liveMomentum: 0,
  liveRange: 0,
  avgOneMinMove: 0,
  diagnostics: {}
};
let lastSnapshot = null;
let paused = false;

function readField(id) { return cleanNum($(id).value); }
function setFieldIfEmpty(id, value, decimals = 2) {
  if (!Number.isFinite(value)) return;
  if ($(id).value === '') $(id).value = value.toFixed(decimals);
}

function starRating(chance, risk) {
  if (chance >= 82 && risk < 42) return 5;
  if (chance >= 74 && risk < 52) return 4;
  if (chance >= 64 && risk < 64) return 3;
  if (chance >= 55) return 2;
  return 1;
}

function setScale(chance) {
  for (let i = 1; i <= 5; i++) $('scale' + i).classList.remove('activeScale');
  const idx = chance >= 80 ? 5 : chance >= 70 ? 4 : chance >= 60 ? 3 : chance >= 50 ? 2 : 1;
  $('scale' + idx).classList.add('activeScale');
}

function sourceRow(label, value) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function updateSourceStatus() {
  const m = live.kalshi?.market;
  const b = live.btc;
  const c = live.coinbase;
  $('sourceStatus').innerHTML = [
    sourceRow('BTC spot', b?.ok ? `${fmtUsd(b.price)} (${b.source || 'source'})` : 'not loaded'),
    sourceRow('Kalshi market', m ? `${m.ticker || 'active'} ${m.status || ''}` : 'not loaded'),
    sourceRow('Kalshi YES / NO', m ? `${fmtCents(m.yesAsk ?? m.yesBid)} / ${fmtCents(m.noAsk ?? m.noBid)}` : '--'),
    sourceRow('Orderbook', live.kalshi?.orderbook ? 'loaded' : 'not loaded'),
    sourceRow('Trades', live.kalshi?.trades?.length ? `${live.kalshi.trades.length} recent` : 'not loaded'),
    sourceRow('Coinbase book', c?.book ? `imbalance ${Number(c.book.imbalance || 0).toFixed(0)}%` : 'not loaded'),
    sourceRow('Candles', live.candles?.length ? `${live.candles.length} x 1m` : 'not loaded')
  ].join('');
  $('diagnostics').textContent = JSON.stringify({
    fetchedAt: new Date().toISOString(),
    btc: live.btc,
    kalshi: live.kalshi,
    coinbase: live.coinbase,
    candles: live.candles?.slice(-8),
    lastSnapshot
  }, null, 2);
}

async function fetchJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(path + sep + '_=' + Date.now(), { cache: 'no-store' });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(json?.error?.message || json?.error || `HTTP ${r.status}`);
  return json;
}

async function refreshLiveData({ fill = false } = {}) {
  $('lastUpdated').textContent = 'Refreshing live data...';
  const tasks = await Promise.allSettled([
    fetchJson('/api/btc'),
    fetchJson('/api/kalshi?series=KXBTC15M'),
    fetchJson('/api/coinbase?light=1'),
    fetchJson('/api/candles?minutes=45&granularity=60')
  ]);

  const [btc, kalshi, coinbase, candles] = tasks;
  if (btc.status === 'fulfilled') live.btc = btc.value;
  if (kalshi.status === 'fulfilled') live.kalshi = kalshi.value;
  if (coinbase.status === 'fulfilled') live.coinbase = coinbase.value;
  if (candles.status === 'fulfilled') live.candles = candles.value?.candles || [];

  live.diagnostics.errors = tasks.map((t, i) => t.status === 'rejected' ? { source: ['btc','kalshi','coinbase','candles'][i], error: String(t.reason?.message || t.reason) } : null).filter(Boolean);

  updateLiveDerived();
  updateLiveReadouts();
  if (fill) fillFromLive();
  updateSourceStatus();
  $('lastUpdated').textContent = 'Last updated ' + new Date().toLocaleTimeString();
}

function updateLiveDerived() {
  const candles = live.candles || live.coinbase?.candles || [];
  if (candles.length < 3) return;
  const recent = candles.slice(-6);
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const change = last - first;
  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  const range = Math.max(0, high - low);
  const moves = recent.slice(1).map((c, i) => Math.abs(c.close - recent[i].close));
  live.liveMomentum = range ? clamp(change / range, -1, 1) : 0;
  live.liveRange = range;
  live.avgOneMinMove = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : 0;
}

function updateLiveReadouts() {
  const price = live.btc?.price ?? live.coinbase?.price ?? (live.candles?.at(-1)?.close ?? NaN);
  $('livePrice').textContent = Number.isFinite(price) ? fmtUsd(price) : 'Live fetch blocked';
  const lm = live.liveMomentum;
  $('liveTrend').textContent = lm > 0.25 ? 'Up' : lm < -0.25 ? 'Down' : 'Choppy';
  drawChart();
}

function fillFromLive() {
  const price = live.btc?.price ?? live.coinbase?.price ?? live.candles?.at(-1)?.close;
  const m = live.kalshi?.market || {};
  setFieldIfEmpty('current', price, 2);
  setFieldIfEmpty('target', m.target, 2);
  setFieldIfEmpty('overMarket', m.yesAsk ?? m.yesBid, 1);
  setFieldIfEmpty('underMarket', m.noAsk ?? m.noBid, 1);
  if ((Number.isFinite(m.yesAsk) || Number.isFinite(m.noAsk)) && $('overMarket').value === '') $('overMarket').value = String(m.yesAsk ?? m.yesBid);
  if (m.closeTime && $('mins').value === '' && $('secs').value === '') {
    const ms = new Date(m.closeTime).getTime() - Date.now();
    const total = Math.max(0, Math.floor(ms / 1000));
    $('mins').value = Math.floor(total / 60);
    $('secs').value = total % 60;
  }
}

function analyzeFromLiveOrInputs() {
  if (!Number.isFinite(readField('current'))) setFieldIfEmpty('current', live.btc?.price ?? live.coinbase?.price ?? live.candles?.at(-1)?.close, 2);
  if (!Number.isFinite(readField('target'))) setFieldIfEmpty('target', live.kalshi?.market?.target, 2);
  if (!Number.isFinite(readField('overMarket'))) setFieldIfEmpty('overMarket', live.kalshi?.market?.yesAsk ?? live.kalshi?.market?.yesBid, 1);
  if (!Number.isFinite(readField('underMarket'))) setFieldIfEmpty('underMarket', live.kalshi?.market?.noAsk ?? live.kalshi?.market?.noBid, 1);
  calculate();
}

function getTimeMinutes() {
  const mins = readField('mins');
  const secs = readField('secs');
  if (Number.isFinite(mins) || Number.isFinite(secs)) return Math.max(0, (Number.isFinite(mins) ? mins : 0) + (Number.isFinite(secs) ? secs : 0) / 60);
  const close = live.kalshi?.market?.closeTime;
  if (close) return Math.max(0, (new Date(close).getTime() - Date.now()) / 60000);
  return NaN;
}

function marketProbabilityFromPrices(overMarket, underMarket) {
  if (Number.isFinite(overMarket) && Number.isFinite(underMarket) && overMarket > 0 && underMarket > 0) {
    return overMarket / (overMarket + underMarket) * 100;
  }
  if (Number.isFinite(overMarket) && overMarket > 0 && overMarket < 100) return overMarket;
  if (Number.isFinite(underMarket) && underMarket > 0 && underMarket < 100) return 100 - underMarket;
  return NaN;
}

function calculate() {
  const current = readField('current');
  const target = readField('target');
  const overMarket = readField('overMarket');
  const underMarket = readField('underMarket');
  const trend = readField('trend');
  const mode = $('mode').value;
  const timeMin = getTimeMinutes();

  if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(timeMin)) {
    $('choice').className = 'choice hold';
    $('choice').textContent = 'NEED INPUTS';
    $('explain').textContent = 'Need current BTC price, target price, and time remaining. Use live fill or enter them manually.';
    return;
  }

  const gap = target - current; // positive = current below target, YES/OVER needs rally
  const absGap = Math.abs(gap);
  const needPerMin = timeMin > 0 ? gap / timeMin : gap;
  const liveMomentum = Number.isFinite(live.liveMomentum) ? live.liveMomentum : 0;
  const avgOneMinMove = live.avgOneMinMove || Math.max(1, live.liveRange / 6 || 1);
  const liveRange = live.liveRange || Math.max(1, avgOneMinMove * 5);
  const requiredMoveRatio = Math.abs(needPerMin) / Math.max(1, avgOneMinMove);
  const nearTargetRisk = absGap < Math.max(12, liveRange * 0.35) ? 18 : absGap < Math.max(25, liveRange * 0.7) ? 10 : 0;
  const lateWindowRisk = timeMin < 1.5 ? 30 : timeMin < 3 ? 20 : timeMin < 5 ? 10 : 3;
  const whipsawRisk = liveRange > 0 ? clamp((liveRange / Math.max(1, absGap + avgOneMinMove)) * 18, 0, 28) : 12;
  const timePressure = clamp((15 - timeMin) * 0.7, 0, 9);
  const bookImbalance = live.coinbase?.book?.imbalance || 0;
  const kalshiPressure = live.kalshi?.orderbook?.pressure || 0;

  let overScore = 50;

  // Distance/read: being above target favors OVER; below target favors UNDER.
  const distanceScore = clamp((-gap / Math.max(18, avgOneMinMove * 3)) * 18, -24, 24);
  overScore += distanceScore;

  // Live chart and screenshot movement.
  overScore += liveMomentum * 13;
  overScore += clamp(trend, -2, 2) * 5.5;

  // Required move effect: if current side already has cushion, strengthen it.
  if (gap < 0) overScore += clamp(absGap / Math.max(10, avgOneMinMove * 2), 0, 9);
  if (gap > 0) overScore -= clamp(absGap / Math.max(10, avgOneMinMove * 2), 0, 9);

  // Coinbase book and Kalshi pressure are supporting, not dominating.
  overScore += clamp(bookImbalance / 100, -1, 1) * 4;
  overScore += clamp(kalshiPressure, -1, 1) * 5;

  // Market price can slightly anchor the read, but avoid just copying Kalshi.
  const impliedOver = marketProbabilityFromPrices(overMarket, underMarket);
  if (Number.isFinite(impliedOver)) overScore = overScore * 0.82 + impliedOver * 0.18;

  overScore = clamp(overScore, 1, 99);
  let underScore = 100 - overScore;
  const rawPick = overScore >= underScore ? 'OVER' : 'UNDER';
  const confidence = Math.max(overScore, underScore);

  const totalRisk = clamp(
    (100 - confidence) * 0.48 +
    lateWindowRisk * 0.8 +
    nearTargetRisk +
    whipsawRisk * 0.58 +
    timePressure +
    (requiredMoveRatio > 1.5 ? 6 : 0),
    0,
    100
  );

  const riskPenaltyRate = mode === 'early' ? 0.15 : mode === 'conservative' ? 0.25 : 0.19;
  const maxRiskPenalty = mode === 'early' ? 14 : mode === 'conservative' ? 22 : 17;
  const riskPenalty = clamp(totalRisk * riskPenaltyRate, 0, maxRiskPenalty);
  const successChance = clamp(confidence - riskPenalty, 1, 99);

  let action = 'SKIP / NO BET';
  if (mode === 'early') {
    if (successChance >= 72 && totalRisk < 65) action = 'TAKE ' + rawPick;
    else if (successChance >= 62 && totalRisk < 75) action = 'LEAN ' + rawPick;
    else if (successChance >= 55) action = 'EARLY LEAN ' + rawPick;
  } else if (mode === 'conservative') {
    if (successChance >= 84 && totalRisk < 38) action = 'TAKE ' + rawPick;
    else if (successChance >= 76 && totalRisk < 48) action = 'LEAN ' + rawPick;
    else if (successChance >= 68 && totalRisk < 58) action = 'SMALL LEAN ' + rawPick;
  } else {
    if (successChance >= 80 && totalRisk < 48) action = 'TAKE ' + rawPick;
    else if (successChance >= 70 && totalRisk < 58) action = 'LEAN ' + rawPick;
    else if (successChance >= 60 && totalRisk < 70) action = 'SMALL LEAN ' + rawPick;
  }

  let edge = NaN;
  if (Number.isFinite(impliedOver)) {
    edge = rawPick === 'OVER' ? overScore - impliedOver : underScore - (100 - impliedOver);
    if (edge < -3 && action.startsWith('TAKE')) action = 'WAIT PRICE / ' + rawPick;
  }

  const pick = action.includes('SKIP') ? 'WAIT' : rawPick;
  $('choice').className = 'choice ' + (pick === 'UNDER' ? 'under' : pick === 'OVER' ? 'over' : 'hold');
  $('choice').textContent = pick === 'WAIT' ? 'SKIP / WAIT' : pick;
  $('successPct').textContent = fmtPct(successChance);
  $('successPct').style.color = successChance >= 80 ? '#48e68d' : successChance >= 70 ? '#7cc7ff' : successChance >= 60 ? '#ffd166' : successChance >= 50 ? '#ff9f43' : '#ff6b85';
  const stars = starRating(successChance, totalRisk);
  $('betQuality').textContent = '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars);
  setScale(successChance);

  $('fill').style.width = underScore.toFixed(2) + '%';
  $('fill').style.background = rawPick === 'UNDER' ? 'var(--red)' : 'var(--green)';
  $('underProb').textContent = fmtPct(underScore);
  $('overProb').textContent = fmtPct(overScore);
  $('gap').textContent = (gap >= 0 ? '$' : '-$') + Math.abs(gap).toFixed(2);
  $('need').textContent = '$' + Math.abs(needPerMin).toFixed(2) + ' toward ' + (gap >= 0 ? 'Over' : 'Under');
  $('risk').textContent = totalRisk < 35 ? 'Lower risk' : totalRisk < 60 ? 'Medium risk' : 'High risk';
  $('action').textContent = action;
  $('confidence').textContent = confidence.toFixed(0) + '/100';
  $('lateDanger').textContent = lateWindowRisk >= 20 ? 'High' : lateWindowRisk >= 10 ? 'Medium' : 'Low';
  $('whipsaw').textContent = whipsawRisk >= 22 ? 'High' : whipsawRisk >= 12 ? 'Medium' : 'Low';
  $('valueRead').textContent = Number.isFinite(edge) ? (edge > 8 ? 'Possible value +' + edge.toFixed(0) : edge > 0 ? 'Small edge +' + edge.toFixed(0) : 'No clear edge ' + edge.toFixed(0)) : 'Need market %';

  const why = [];
  if (pick === 'WAIT') why.push('No trade: the edge is not strong enough after risk adjustment.');
  else why.push('Recommended pick is ' + rawPick + ' with a ' + successChance.toFixed(0) + '% estimated success chance.');
  if (rawPick === 'UNDER' && gap > 0) why.push('BTC is below the target, so Under is currently winning.');
  if (rawPick === 'OVER' && gap < 0) why.push('BTC is above the target, so Over is currently winning.');
  if (rawPick === 'OVER' && liveMomentum > 0.25) why.push('Live momentum supports Over.');
  if (rawPick === 'UNDER' && liveMomentum < -0.25) why.push('Live momentum supports Under.');
  if (Number.isFinite(edge) && edge > 6) why.push('Market pricing may be giving a value edge.');
  if (Number.isFinite(edge) && edge < -3) why.push('Market price looks expensive compared with the model estimate.');
  if (timeMin < 4) why.push('Late-window danger is elevated.');
  if (nearTargetRisk) why.push('Target is close enough for a quick flip.');
  if (whipsawRisk >= 22) why.push('Recent movement is choppy, so whipsaw risk is high.');
  if (requiredMoveRatio > 1.3) why.push('Required move per minute is meaningful for this short window.');
  if (successChance < 60) why.push('Success chance is below the threshold for a good setup.');

  $('whyList').innerHTML = why.map(x => '<li>' + x + '</li>').join('');
  $('explain').textContent = `Mode: ${mode}. The model uses distance to target, time remaining, live BTC momentum, screenshot trend, market pricing, Kalshi pressure, and risk filters. It can say skip even when one side is slightly favored.`;
  $('riskDetails').innerHTML =
    '<b>Risk breakdown:</b><br>' +
    '• Recommended pick: ' + (pick === 'WAIT' ? 'None' : rawPick) + '<br>' +
    '• Chance of success: ' + successChance.toFixed(0) + '%<br>' +
    '• Bet quality: ' + stars + '/5<br>' +
    '• Required move ratio: ' + requiredMoveRatio.toFixed(2) + 'x recent 1-minute movement<br>' +
    '• Recent live range: $' + liveRange.toFixed(2) + '<br>' +
    '• Avg 1-minute movement: $' + avgOneMinMove.toFixed(2) + '<br>' +
    '• Total risk score: ' + totalRisk.toFixed(0) + '/100';

  lastSnapshot = { ts: new Date().toISOString(), current, target, timeMin, overMarket, underMarket, impliedOver, overScore, underScore, rawPick, action, successChance, totalRisk, mode };
  localStorage.setItem('edge15Genesis027LastInputs', JSON.stringify({ current, target, mins: $('mins').value, secs: $('secs').value, overMarket, underMarket, trend, mode }));
  updateSourceStatus();
}

function drawChart() {
  const c = $('chart');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = i * c.height / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
  }
  const candles = live.candles || live.coinbase?.candles || [];
  if (!candles.length) return;
  const closes = candles.map(d => d.close).filter(Number.isFinite);
  if (closes.length < 2) return;
  const min = Math.min(...closes), max = Math.max(...closes);
  const pad = (max - min) * 0.12 || 1;
  const yFor = v => c.height - ((v - (min - pad)) / ((max + pad) - (min - pad))) * c.height;
  ctx.lineWidth = 4;
  ctx.strokeStyle = live.liveMomentum >= 0 ? '#00c853' : '#ff2d55';
  ctx.beginPath();
  closes.forEach((v, i) => {
    const x = i / (closes.length - 1) * c.width;
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const target = readField('target');
  if (Number.isFinite(target) && target >= min - pad && target <= max + pad) {
    const y = yFor(target);
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}

async function readScreenshot() {
  if (!selectedImage) {
    $('ocrStatus').textContent = 'Upload a screenshot first.';
    return;
  }
  if (!window.Tesseract) {
    $('ocrStatus').textContent = 'OCR library did not load. Fill the fields manually.';
    return;
  }
  $('ocrStatus').textContent = 'Reading screenshot... first run may take 10–20 seconds.';
  try {
    const result = await Tesseract.recognize(selectedImage, 'eng', {
      logger: m => {
        if (m.status) $('ocrStatus').textContent = m.status + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '');
      }
    });
    const text = result.data.text || '';
    $('ocrText').style.display = 'block';
    $('ocrText').textContent = text;

    const money = [...text.matchAll(/\$?\s*([0-9]{2,3}[,\s]?[0-9]{3}\.[0-9]{2})/g)].map(m => cleanNum(m[1]));
    if (money.length >= 1) $('current').value = money[0].toFixed(2);
    if (money.length >= 2) $('target').value = money[1].toFixed(2);

    const time = text.match(/(\d{1,2})\s*[:;]\s*(\d{2})/);
    if (time) {
      $('mins').value = parseInt(time[1], 10);
      $('secs').value = parseInt(time[2], 10);
    }

    const normalized = text.replace(/[|]/g, ' ').replace(/[Oo0]ver/g, 'Over').replace(/[Uu]nder/g, 'Under').replace(/\s+/g, ' ');
    const over = normalized.match(/Over\s*(?:price|percent|%)?\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)/i);
    const under = normalized.match(/Under\s*(?:price|percent|%)?\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)/i);
    if (over) $('overMarket').value = over[1];
    if (under) $('underMarket').value = under[1];

    $('ocrStatus').textContent = 'Fields filled. Check them, then hit Analyze.';
  } catch (e) {
    $('ocrStatus').textContent = 'Could not read screenshot automatically. Fill the fields manually.';
  }
}

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem('edge15Genesis027LastInputs') || '{}');
    for (const [k, v] of Object.entries(saved)) {
      if ($(k) && v !== undefined && v !== null) $(k).value = v;
    }
  } catch {}
}

$('shot').addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  selectedImage = file;
  $('preview').src = URL.createObjectURL(file);
  $('preview').style.display = 'block';
});
$('readShotBtn').addEventListener('click', readScreenshot);
$('refreshLiveBtn').addEventListener('click', () => refreshLiveData({ fill: false }));
$('liveFillBtn').addEventListener('click', async () => { await refreshLiveData({ fill: true }); analyzeFromLiveOrInputs(); });
$('analyzeBtn').addEventListener('click', analyzeFromLiveOrInputs);
$('copyDiagBtn').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('diagnostics').textContent || '');
  $('copyDiagBtn').textContent = 'Copied';
  setTimeout(() => $('copyDiagBtn').textContent = 'Copy diagnostics', 1200);
});

restoreInputs();
refreshLiveData({ fill: false });
setInterval(() => { if (!paused) refreshLiveData({ fill: false }); }, 5000);
