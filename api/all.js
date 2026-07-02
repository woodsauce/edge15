import { send, handleOptions, fetchJson, compactError, nowIso } from './_utils.js';

async function call(req, path) {
  const host = req.headers.host || 'localhost';
  const proto = host.includes('localhost') ? 'http' : 'https';
  return fetchJson(`${proto}://${host}${path}`, {}, 12000);
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const entries = await Promise.allSettled([
    call(req, '/api/kalshi?series=KXBTC15M'),
    call(req, '/api/coinbase?light=1'),
    call(req, '/api/binance'),
    call(req, '/api/deribit')
  ]);
  const names = ['kalshi', 'coinbase', 'binance', 'deribit'];
  const out = { ok: true, fetchedAt: nowIso() };
  const errors = [];
  entries.forEach((entry, i) => {
    if (entry.status === 'fulfilled') out[names[i]] = entry.value;
    else {
      out[names[i]] = null;
      errors.push({ source: names[i], error: compactError(entry.reason) });
    }
  });
  out.errors = errors;
  out.ok = errors.length < entries.length;
  send(res, 200, out);
}
