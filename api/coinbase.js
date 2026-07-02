import { send, handleOptions, fetchJson, compactError, nowIso, toNum, readQuery } from './_utils.js';

const BASE = 'https://api.exchange.coinbase.com';

function normalizeCandles(rows) {
  return (rows || []).map(r => ({
    time: r[0] * 1000,
    low: toNum(r[1]),
    high: toNum(r[2]),
    open: toNum(r[3]),
    close: toNum(r[4]),
    volume: toNum(r[5])
  })).sort((a, b) => a.time - b.time);
}

function normalizeBook(book) {
  const side = levels => (levels || []).map(x => ({
    price: toNum(x[0], 0),
    size: toNum(x[1], 0),
    orders: toNum(x[2], null)
  })).filter(x => x.price > 0 && x.size > 0);
  const bids = side(book?.bids).sort((a, b) => b.price - a.price);
  const asks = side(book?.asks).sort((a, b) => a.price - b.price);
  const depth = levels => levels.slice(0, 25).reduce((sum, x) => sum + x.size, 0);
  const bidDepth = depth(bids);
  const askDepth = depth(asks);
  const total = bidDepth + askDepth;
  return {
    bestBid: bids[0]?.price ?? null,
    bestAsk: asks[0]?.price ?? null,
    bidDepth,
    askDepth,
    imbalance: total ? ((bidDepth - askDepth) / total) * 100 : 0,
    spread: bids[0] && asks[0] ? asks[0].price - bids[0].price : null,
    bids: bids.slice(0, 10),
    asks: asks.slice(0, 10)
  };
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const product = 'BTC-USD';
  const q = readQuery(req);
  const light = q.light === '1' || q.light === 'true';
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - (60 * 90);
    const [ticker, stats, candlesRaw, bookRaw] = await Promise.allSettled([
      fetchJson(`${BASE}/products/${product}/ticker`),
      light ? Promise.resolve({}) : fetchJson(`${BASE}/products/${product}/stats`),
      light ? Promise.resolve([]) : fetchJson(`${BASE}/products/${product}/candles?granularity=60&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`),
      fetchJson(`${BASE}/products/${product}/book?level=2`)
    ]);

    const errors = [];
    for (const [name, result] of [['ticker', ticker], ['stats', stats], ['candles', candlesRaw], ['book', bookRaw]]) {
      if (result.status === 'rejected') errors.push({ source: name, error: compactError(result.reason) });
    }

    const t = ticker.status === 'fulfilled' ? ticker.value : {};
    const s = stats.status === 'fulfilled' ? stats.value : {};
    const candles = candlesRaw.status === 'fulfilled' ? normalizeCandles(candlesRaw.value) : [];
    const book = bookRaw.status === 'fulfilled' ? normalizeBook(bookRaw.value) : null;

    send(res, 200, {
      ok: errors.length < 4,
      fetchedAt: nowIso(),
      product,
      price: toNum(t.price),
      tradeId: t.trade_id || null,
      size: toNum(t.size, null),
      time: t.time || null,
      bid: toNum(t.bid, book?.bestBid ?? null),
      ask: toNum(t.ask, book?.bestAsk ?? null),
      volume: toNum(t.volume, null),
      stats: {
        open: toNum(s.open, null),
        high: toNum(s.high, null),
        low: toNum(s.low, null),
        volume: toNum(s.volume, null)
      },
      candles,
      book,
      errors
    });
  } catch (err) {
    send(res, 500, { ok: false, fetchedAt: nowIso(), error: compactError(err) });
  }
}
