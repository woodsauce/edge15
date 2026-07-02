import { send, handleOptions, fetchJson, compactError, nowIso, toNum } from './_utils.js';

function normalizeSource(name, payload) {
  if (name === 'coinbase') {
    return {
      source: 'Coinbase Exchange',
      price: toNum(payload.price),
      bid: toNum(payload.bid, null),
      ask: toNum(payload.ask, null),
      time: payload.time || null,
      raw: payload
    };
  }
  if (name === 'kraken') {
    const xbt = payload?.result?.XXBTZUSD || payload?.result?.XBTUSD || Object.values(payload?.result || {})[0] || {};
    return {
      source: 'Kraken',
      price: toNum(xbt.c?.[0]),
      bid: toNum(xbt.b?.[0], null),
      ask: toNum(xbt.a?.[0], null),
      time: nowIso(),
      raw: xbt
    };
  }
  if (name === 'gemini') {
    return {
      source: 'Gemini',
      price: toNum(payload.last),
      bid: toNum(payload.bid, null),
      ask: toNum(payload.ask, null),
      time: nowIso(),
      raw: payload
    };
  }
  if (name === 'bitstamp') {
    return {
      source: 'Bitstamp',
      price: toNum(payload.last),
      bid: toNum(payload.bid, null),
      ask: toNum(payload.ask, null),
      time: payload.timestamp ? new Date(Number(payload.timestamp) * 1000).toISOString() : nowIso(),
      raw: payload
    };
  }
  return null;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const attempts = [
    ['coinbase', 'https://api.exchange.coinbase.com/products/BTC-USD/ticker'],
    ['kraken', 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD'],
    ['gemini', 'https://api.gemini.com/v1/pubticker/btcusd'],
    ['bitstamp', 'https://www.bitstamp.net/api/v2/ticker/btcusd/']
  ];
  const errors = [];
  for (const [name, url] of attempts) {
    try {
      const payload = await fetchJson(url, {}, 7000);
      const normalized = normalizeSource(name, payload);
      if (Number.isFinite(normalized?.price)) {
        send(res, 200, { ok: true, fetchedAt: nowIso(), ...normalized, errors });
        return;
      }
      errors.push({ source: name, error: { message: 'No usable price in response' } });
    } catch (err) {
      errors.push({ source: name, error: compactError(err) });
    }
  }
  send(res, 502, { ok: false, fetchedAt: nowIso(), error: { message: 'All BTC spot sources failed' }, errors });
}
