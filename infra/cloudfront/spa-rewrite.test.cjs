// Pruebas locales de la CloudFront Function, sin AWS: `node infra/cloudfront/spa-rewrite.test.cjs`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'spa-rewrite.js'), 'utf8');
const handler = new Function(`${src}; return handler;`)();
const event = (uri, host, querystring = {}) => ({
  request: { method: 'GET', uri, querystring, headers: host ? { host: { value: host } } : {}, cookies: {} },
});
const result = (out) => (out.statusCode ? `${out.statusCode} ${out.headers.location.value}` : out.uri);

const cases = [
  ['/precios', 'vendix.online', {}, '301 https://vendix.online/pricing'],
  ['/precios/', 'vendix.online', {}, '301 https://vendix.online/pricing'],
  ['/precios', 'vendix.online', { utm_source: { value: 'x' } }, '301 https://vendix.online/pricing?utm_source=x'],
  ['/pricing', 'www.vendix.online', { a: { value: '1', multiValue: [{ value: '1' }, { value: '2' }] } }, '301 https://vendix.online/pricing?a=1&a=2'],
  ['/main-ABC.js', 'www.vendix.online', {}, '301 https://vendix.online/main-ABC.js'],
  ['/precios', 'tienda-demo.vendix.online', {}, '/index.html'],
  ['/precios', 'midominio.com', {}, '/index.html'],
  ['/legal/privacidad', 'vendix.online', {}, '/index.html'],
  ['/catalog/aceite-1.5l', 'tienda-demo.vendix.online', {}, '/index.html'],
  ['/main-ABC.js', 'vendix.online', {}, '/main-ABC.js'],
  ['/no-existe.js', 'vendix.online', {}, '/no-existe.js'],
  ['/.well-known/apple-app-site-association', 'www.vendix.online', {}, '/.well-known/apple-app-site-association'],
  ['/legal/privacidad', null, {}, '/index.html'],
];

for (const [uri, host, qs, expected] of cases) {
  assert.strictEqual(result(handler(event(uri, host, qs))), expected, `${host}${uri}`);
}
console.log(`ok ${cases.length} casos`);
