import { send, handleOptions, readQuery, kalshiGet, compactError, asCents, toNum, safeDate, nowIso } from './_utils.js';

function pickMarket(markets) {
  const now = Date.now();
  const usable = (markets || [])
    .filter(m => {
      const close = safeDate(m.close_time || m.latest_expiration_time || m.expiration_time);
      const open = safeDate(m.open_time);
      if (close && close < now - 60_000) return false;
      if (open && open > now + 60_000) return false;
      return true;
    })
    .sort((a, b) => {
      const ca = safeDate(a.close_time || a.latest_expiration_time || a.expiration_time) || Infinity;
      const cb = safeDate(b.close_time || b.latest_expiration_time || b.expiration_time) || Infinity;
      return ca - cb;
    });
  return usable[0] || (markets || [])[0] || null;
}

function inferTarget(market) {
  const fields = [
    market?.strike,
    market?.floor_strike,
    market?.cap_strike,
    market?.price_to_beat,
    market?.subtitle,
    market?.yes_sub_title,
    market?.no_sub_title,
    market?.title,
    market?.rules_primary,
    market?.rules_secondary
  ];
  for (const f of fields) {
    if (f === null || f === undefined) continue;
    if (typeof f === 'number') return f;
    const text = String(f).replace(/,/g, '');
    const dollars = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if (dollars) return Number(dollars[1]);
    const plain = text.match(/(?:above|below|beat|target|least|than)\s+([0-9]{4,}(?:\.[0-9]+)?)/i);
    if (plain) return Number(plain[1]);
  }
  return null;
}

function parseOrderbook(orderbook) {
  const ob = orderbook?.orderbook_fp || orderbook?.orderbook || orderbook || {};
  const yes = ob.yes_dollars || ob.yes || [];
  const no = ob.no_dollars || ob.no || [];
  const parseSide = levels => (levels || []).map(level => {
    const price = asCents(level[0]);
    const size = toNum(level[1], 0);
    const orders = toNum(level[2], null);
    return { price, size, orders };
  }).filter(x => x.price !== null && x.size > 0).sort((a, b) => b.price - a.price);
  const yesLevels = parseSide(yes);
  const noLevels = parseSide(no);
  const depth = side => side.slice(0, 5).reduce((sum, x) => sum + x.size, 0);
  const weighted = side => {
    const sz = side.slice(0, 5).reduce((sum, x) => sum + x.size, 0);
    if (!sz) return null;
    return side.slice(0, 5).reduce((sum, x) => sum + x.price * x.size, 0) / sz;
  };
  const yesDepth = depth(yesLevels);
  const noDepth = depth(noLevels);
  const total = yesDepth + noDepth;
  const pressure = total ? ((yesDepth - noDepth) / total) * 100 : 0;
  return {
    yesLevels,
    noLevels,
    bestYesBid: yesLevels[0]?.price ?? null,
    bestNoBid: noLevels[0]?.price ?? null,
    impliedYesAsk: noLevels[0]?.price != null ? Math.round((100 - noLevels[0].price) * 10) / 10 : null,
    impliedNoAsk: yesLevels[0]?.price != null ? Math.round((100 - yesLevels[0].price) * 10) / 10 : null,
    yesDepth,
    noDepth,
    weightedYesBid: weighted(yesLevels),
    weightedNoBid: weighted(noLevels),
    pressure
  };
}

function normalizeMarket(m) {
  if (!m) return null;
  const yesBid = asCents(m.yes_bid_dollars ?? m.yes_bid);
  const yesAsk = asCents(m.yes_ask_dollars ?? m.yes_ask);
  const noBid = asCents(m.no_bid_dollars ?? m.no_bid);
  const noAsk = asCents(m.no_ask_dollars ?? m.no_ask);
  const last = asCents(m.last_price_dollars ?? m.last_price);
  return {
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    seriesTicker: m.series_ticker || 'KXBTC15M',
    title: m.title || m.yes_sub_title || 'BTC Up or Down - 15 minutes',
    yesSubTitle: m.yes_sub_title || null,
    noSubTitle: m.no_sub_title || null,
    status: m.status,
    openTime: m.open_time,
    closeTime: m.close_time || m.latest_expiration_time || m.expiration_time,
    expirationTime: m.latest_expiration_time || m.expiration_time || m.close_time,
    target: inferTarget(m),
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    last,
    volume: toNum(m.volume_fp ?? m.volume, null),
    volume24h: toNum(m.volume_24h_fp, null),
    openInterest: toNum(m.open_interest_fp ?? m.open_interest, null),
    raw: m
  };
}

async function optional(path, fallback) {
  try { return await kalshiGet(path); }
  catch (err) { return { _error: compactError(err), ...fallback }; }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const q = readQuery(req);
  const series = q.series || 'KXBTC15M';
  const nowSec = Math.floor(Date.now() / 1000);
  const startTs = q.start_ts || String(nowSec - 3600);
  const endTs = q.end_ts || String(nowSec + 120);

  const diagnostics = [];
  try {
    let marketsData;
    try {
      marketsData = await kalshiGet(`/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=100`);
    } catch (err) {
      diagnostics.push({ step: 'series_ticker open markets failed', error: compactError(err) });
      marketsData = await kalshiGet(`/markets?status=open&limit=100`);
    }

    const allMarkets = marketsData.markets || [];
    const filtered = allMarkets.filter(m => {
      const text = `${m.ticker || ''} ${m.event_ticker || ''} ${m.title || ''} ${m.yes_sub_title || ''}`.toUpperCase();
      return text.includes(series.toUpperCase()) || text.includes('BTC') || text.includes('BITCOIN');
    });
    const market = normalizeMarket(pickMarket(filtered.length ? filtered : allMarkets));

    let orderbook = null;
    let trades = null;
    let candles = null;
    let parsedOrderbook = null;

    if (market?.ticker) {
      orderbook = await optional(`/markets/${encodeURIComponent(market.ticker)}/orderbook`, { orderbook_fp: { yes_dollars: [], no_dollars: [] } });
      parsedOrderbook = parseOrderbook(orderbook);
      trades = await optional(`/markets/trades?ticker=${encodeURIComponent(market.ticker)}&limit=100`, { trades: [] });
      candles = await optional(`/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(market.ticker)}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=1&include_latest_before_start=true`, { candlesticks: [] });
    }

    send(res, 200, {
      ok: true,
      fetchedAt: nowIso(),
      series,
      market,
      candidates: filtered.slice(0, 8).map(normalizeMarket),
      orderbook: parsedOrderbook,
      rawOrderbook: orderbook,
      trades: trades?.trades || [],
      candles: candles?.candlesticks || [],
      diagnostics
    });
  } catch (err) {
    send(res, 500, {
      ok: false,
      fetchedAt: nowIso(),
      error: compactError(err),
      hint: 'Kalshi public market data should work without keys. If orderbook access returns 401, set KALSHI_KEY_ID and KALSHI_PRIVATE_KEY in Vercel environment variables.'
    });
  }
}
