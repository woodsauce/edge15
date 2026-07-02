import crypto from 'crypto';

export function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload, null, 2));
}

export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}

export function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asCents(value) {
  const n = toNum(value, null);
  if (n === null) return null;
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

export function dollars(value) {
  const n = toNum(value, null);
  if (n === null) return null;
  return n;
}

export function safeDate(value) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function readQuery(req) {
  try {
    const u = new URL(req.url, 'http://localhost');
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return {};
  }
}

export async function fetchJson(url, options = {}, timeoutMs = 9500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} for ${url}`);
      err.status = response.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(id);
  }
}

export function kalshiBaseUrl() {
  return process.env.KALSHI_API_BASE_URL || 'https://external-api.kalshi.com/trade-api/v2';
}

export function kalshiHeaders(method, pathWithQuery) {
  const keyId = process.env.KALSHI_KEY_ID || process.env.KALSHI_API_KEY_ID || process.env.KALSHI_ACCESS_KEY;
  let privateKey = process.env.KALSHI_PRIVATE_KEY || process.env.KALSHI_API_PRIVATE_KEY || process.env.KALSHI_PRIVATE_KEY_PEM;
  if (!keyId || !privateKey) return {};

  privateKey = privateKey.replace(/\\n/g, '\n');
  const timestamp = String(Date.now());
  const pathOnly = pathWithQuery.split('?')[0];
  const message = `${timestamp}${method.toUpperCase()}${pathOnly}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }, 'base64');

  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature
  };
}

export async function kalshiGet(pathWithQuery) {
  const base = kalshiBaseUrl().replace(/\/$/, '');
  const url = `${base}${pathWithQuery}`;
  const headers = kalshiHeaders('GET', `/trade-api/v2${pathWithQuery}`);
  return fetchJson(url, { headers }, 10000);
}

export function compactError(err) {
  return {
    message: err?.message || String(err),
    status: err?.status || null,
    payload: err?.payload || null
  };
}
