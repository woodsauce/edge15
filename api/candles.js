import { send, handleOptions, fetchJson, compactError, nowIso, toNum, readQuery } from './_utils.js';

const BASE = 'https://api.exchange.coinbase.com';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const q = readQuery(req);
  const product = q.product || 'BTC-USD';
  const granularity = Number(q.granularity || 60);
  const minutes = Number(q.minutes || 120);
  const end = Math.floor(Date.now() / 1000);
  const start = end - (60 * Math.max(10, Math.min(minutes, 300)));
  try {
    const rows = await fetchJson(`${BASE}/products/${encodeURIComponent(product)}/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`);
    const candles = (rows || []).map(r => ({
      time: r[0] * 1000,
      low: toNum(r[1]),
      high: toNum(r[2]),
      open: toNum(r[3]),
      close: toNum(r[4]),
      volume: toNum(r[5])
    })).sort((a, b) => a.time - b.time);
    send(res, 200, { ok: true, fetchedAt: nowIso(), product, granularity, candles });
  } catch (err) {
    send(res, 500, { ok: false, fetchedAt: nowIso(), error: compactError(err) });
  }
}
