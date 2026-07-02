import { access } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'api/kalshi.js',
  'api/coinbase.js',
  'api/candles.js',
  'api/binance.js',
  'api/deribit.js',
  'api/health.js',
  'api/all.js',
  'api/_utils.js'
];

for (const file of requiredFiles) {
  await access(file);
}

console.log('Edge15 static build check passed. No Next.js build required.');
