import { send, handleOptions, fetchJson, compactError, nowIso, toNum } from './_utils.js';

const BASE = 'https://fapi.binance.com';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const symbol = 'BTCUSDT';
  try {
    const [openInterest, funding, premium, ticker] = await Promise.allSettled([
      fetchJson(`${BASE}/fapi/v1/openInterest?symbol=${symbol}`),
      fetchJson(`${BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=12`),
      fetchJson(`${BASE}/fapi/v1/premiumIndex?symbol=${symbol}`),
      fetchJson(`${BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`)
    ]);

    const errors = [];
    for (const [name, result] of [['openInterest', openInterest], ['funding', funding], ['premium', premium], ['ticker', ticker]]) {
      if (result.status === 'rejected') errors.push({ source: name, error: compactError(result.reason) });
    }

    const oi = openInterest.status === 'fulfilled' ? openInterest.value : {};
    const f = funding.status === 'fulfilled' ? funding.value : [];
    const p = premium.status === 'fulfilled' ? premium.value : {};
    const t = ticker.status === 'fulfilled' ? ticker.value : {};
    const latestFunding = Array.isArray(f) && f.length ? f[f.length - 1] : null;

    send(res, 200, {
      ok: errors.length < 4,
      fetchedAt: nowIso(),
      symbol,
      openInterest: toNum(oi.openInterest, null),
      openInterestTime: oi.time || null,
      latestFundingRate: toNum(latestFunding?.fundingRate, toNum(p.lastFundingRate, null)),
      nextFundingTime: p.nextFundingTime || null,
      markPrice: toNum(p.markPrice, null),
      indexPrice: toNum(p.indexPrice, null),
      priceChangePercent24h: toNum(t.priceChangePercent, null),
      volume24h: toNum(t.volume, null),
      quoteVolume24h: toNum(t.quoteVolume, null),
      fundingHistory: Array.isArray(f) ? f.map(x => ({
        fundingRate: toNum(x.fundingRate, null),
        fundingTime: x.fundingTime,
        markPrice: toNum(x.markPrice, null)
      })) : [],
      errors
    });
  } catch (err) {
    send(res, 500, { ok: false, fetchedAt: nowIso(), error: compactError(err) });
  }
}
