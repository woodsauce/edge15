import { send, handleOptions, fetchJson, compactError, nowIso, toNum } from './_utils.js';

const BASE = 'https://www.deribit.com/api/v2';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const end = Date.now();
  const start = end - 1000 * 60 * 60 * 24;
  try {
    const data = await fetchJson(`${BASE}/public/get_volatility_index_data?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=60`);
    const points = data?.result?.data || data?.result || [];
    const normalized = Array.isArray(points) ? points.map(row => {
      if (Array.isArray(row)) return { time: row[0], open: toNum(row[1]), high: toNum(row[2]), low: toNum(row[3]), close: toNum(row[4]) };
      return row;
    }) : [];
    const latest = normalized[normalized.length - 1] || null;
    send(res, 200, {
      ok: true,
      fetchedAt: nowIso(),
      currency: 'BTC',
      volatilityIndex: toNum(latest?.close ?? latest?.value, null),
      latest,
      points: normalized.slice(-48)
    });
  } catch (err) {
    send(res, 500, { ok: false, fetchedAt: nowIso(), error: compactError(err) });
  }
}
