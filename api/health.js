import { send, handleOptions, nowIso } from './_utils.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  send(res, 200, {
    ok: true,
    name: 'Edge15 Genesis-024 Early Signal Stack',
    fetchedAt: nowIso(),
    env: {
      kalshiBaseUrl: process.env.KALSHI_API_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2',
      kalshiKeyConfigured: Boolean(process.env.KALSHI_KEY_ID || process.env.KALSHI_API_KEY_ID || process.env.KALSHI_ACCESS_KEY),
      kalshiPrivateKeyConfigured: Boolean(process.env.KALSHI_PRIVATE_KEY || process.env.KALSHI_API_PRIVATE_KEY || process.env.KALSHI_PRIVATE_KEY_PEM)
    },
    endpoints: [
      '/api/kalshi?series=KXBTC15M',
      '/api/coinbase',
      '/api/candles',
      '/api/binance',
      '/api/deribit',
      '/api/all'
    ]
  });
}
