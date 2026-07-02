import { access, mkdir, copyFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'api/kalshi.js',
  'api/btc.js',
  'api/coinbase.js',
  'api/candles.js',
  'api/binance.js',
  'api/deribit.js',
  'api/health.js',
  'api/all.js',
  'api/_utils.js'
];

for (const file of requiredFiles) await access(file);

await mkdir('public', { recursive: true });
await copyFile('index.html', 'public/index.html');
await copyFile('app.js', 'public/app.js');
await copyFile('styles.css', 'public/styles.css');

console.log('Edge15 Genesis-027 rollback static build passed.');
