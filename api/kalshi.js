import { send, handleOptions, readQuery, kalshiGet, compactError, asCents, toNum, safeDate, nowIso } from './_utils.js';

function marketCloseMs(m) {
  return safeDate(m?.close_time || m?.latest_expiration_time || m?.expected_expiration_time || m?.expiration_time);
}

function marketOpenMs(m) {
  return safeDate(m?.open_time || m?.created_time);
}

function pickMarket(markets) {
  const now = Date.now();
  const clean = Array.from(new Map((markets || []).filter(Boolean).map(m => [m.ticker, m])).values());
  const usable = clean
    .filter(m => {
      const close = marketCloseMs(m);
      const open = marketOpenMs(m);
      const status = String(m.status || '').toLowerCase();
      if (status && ['settled','closed'].includes(status)) return false;
      if (close && close < now - 90_000) return false;
      if (open && open > now + 90_000) return false;
      return true;
    })
    .sort((a, b) => {
      const ca = marketCloseMs(a) || Infinity;
      const cb = marketCloseMs(b) || Infinity;
      return ca - cb;
    });
  return usable[0] || clean[0] || null;
}

function inferTarget(market) {
  const fields = [
    market?.strike,
    market?.floor_strike,
    market?.cap_strike,
    market?.functional_strike,
    market?.custom_strike,
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
    const text = typeof f === 'object' ? JSON.stringify(f) : String(f);
    const cleaned = text.replace(/,/g, '');
    const dollars = cleaned.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if (dollars) return Number(dollars[1]);
    const plain = cleaned.match(/(?:above|below|beat|target|least|than|price|strike)\D{0,20}([0-9]{4,}(?:\.[0-9]+)?)/i);
    if (plain) return Number(plain[1]);
    const anyBig = cleaned.match(/\b([0-9]{4,}(?:\.[0-9]+)?)\b/);
    if (anyBig) return Number(anyBig[1]);
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
  const last = asCents(m.last_price_dollars ?? m.last_price ?? m.previous_price_dollars);
  return {
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    seriesTicker: m.series_ticker || 'KXBTC15M',
    title: m.title || m.yes_sub_title || 'BTC Up or Down - 15 minutes',
    yesSubTitle: m.yes_sub_title || null,
    noSubTitle: m.no_sub_title || null,
    status: m.status,
    openTime: m.open_time,
    closeTime: m.close_time || m.latest_expiration_time || m.expected_expiration_time || m.expiration_time,
    expirationTime: m.latest_expiration_time || m.expected_expiration_time || m.expiration_time || m.close_time,
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

function flattenMarkets(payload) {
  if (Array.isArray(payload?.markets)) return payload.markets;
  if (Array.isArray(payload?.events)) {
    return payload.events.flatMap(e => (e.markets || []).map(m => ({ ...m, series_ticker: e.series_ticker || m.series_ticker, event_title: e.title })));
  }
  return [];
}

function btcFilter(markets, series) {
  return (markets || []).filter(m => {
    const text = `${m.ticker || ''} ${m.event_ticker || ''} ${m.series_ticker || ''} ${m.title || ''} ${m.subtitle || ''} ${m.yes_sub_title || ''} ${m.no_sub_title || ''}`.toUpperCase();
    return text.includes(series.toUpperCase()) || text.includes('BTC') || text.includes('BITCOIN');
  });
}

async function discoverMarkets(series, diagnostics) {
  const nowSec = Math.floor(Date.now() / 1000);
  const attempts = [
    { step: 'markets: series open', path: `/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=1000` },
    { step: 'events: series open nested', path: `/events?series_ticker=${encodeURIComponent(series)}&status=open&with_nested_markets=true&limit=200` },
    { step: 'markets: series min_close', path: `/markets?series_ticker=${encodeURIComponent(series)}&min_close_ts=${nowSec - 120}&limit=1000` },
    { step: 'events: series min_close nested', path: `/events?series_ticker=${encodeURIComponent(series)}&with_nested_markets=true&min_close_ts=${nowSec - 120}&limit=200` },
    { step: 'markets: all open btc filter', path: `/markets?status=open&limit=1000` }
  ];
  let best = [];
  for (const attempt of attempts) {
    try {
      const payload = await kalshiGet(attempt.path);
      const raw = flattenMarkets(payload);
      const filtered = btcFilter(raw, series);
      diagnostics.push({ step: attempt.step, ok: true, rawCount: raw.length, btcCount: filtered.length });
      const chosen = filtered.length ? filtered : raw;
      if (chosen.length) {
        best = chosen;
        if (filtered.length || attempt.step.includes('series')) break;
      }
    } catch (err) {
      diagnostics.push({ step: attempt.step, ok: false, error: compactError(err) });
    }
  }
  return btcFilter(best, series).length ? btcFilter(best, series) : best;
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
    const allMarkets = await discoverMarkets(series, diagnostics);
    const market = normalizeMarket(pickMarket(allMarkets));

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
      ok: Boolean(market?.ticker),
      fetchedAt: nowIso(),
      series,
      market,
      candidates: allMarkets.slice(0, 12).map(normalizeMarket),
      orderbook: parsedOrderbook,
      rawOrderbook: orderbook,
      trades: trades?.trades || [],
      candles: candles?.candlesticks || [],
      diagnostics,
      hint: market?.ticker ? null : 'No live KXBTC15M market was found. Check if Kalshi is accessible from this deployment and whether the active series ticker changed.'
    });
  } catch (err) {
    send(res, 500, {
      ok: false,
      fetchedAt: nowIso(),
      error: compactError(err),
      diagnostics,
      hint: 'Kalshi public market data should work without keys. If Vercel cannot reach Kalshi, open /api/kalshi?series=KXBTC15M directly and paste the JSON diagnostics.'
    });
  }
}
