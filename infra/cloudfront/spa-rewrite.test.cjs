// Pruebas locales de la CloudFront Function, sin AWS: `node infra/cloudfront/spa-rewrite.test.cjs`.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'spa-rewrite.js'), 'utf8');
const handler = new Function(`${src}; return handler;`)();
const event = (uri, host, querystring = {}, method = 'GET') => ({
  request: { method, uri, querystring, headers: host ? { host: { value: host } } : {}, cookies: {} },
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
  // www de dominio propio de tienda → apex (el backend solo conoce el apex; en www la tienda sale en blanco).
  ['/', 'www.mesura.beauty', {}, '301 https://mesura.beauty/'],
  ['/productos/labial-rojo', 'WWW.Mesura.Beauty', { utm_source: { value: 'ig' } }, '301 https://mesura.beauty/productos/labial-rojo?utm_source=ig'],
  ['/main-ABC.js', 'www.gorrerolicor.online', {}, '301 https://gorrerolicor.online/main-ABC.js'],
  ['/.well-known/acme-challenge/x', 'www.mesura.beauty', {}, '/.well-known/acme-challenge/x'],
  ['/', 'mesura.beauty', {}, '/index.html'],
  ['/', 'tienda.mesura.beauty', {}, '/index.html'],
  // Subdominios de vendix.online no se tocan (solo www.vendix.online, arriba).
  ['/', 'www.tienda.vendix.online', {}, '/index.html'],
  ['/', 'www.', {}, '/index.html'],
  // SEO-TECH-03: en vendix.online las rutas desconocidas no se reescriben (S3 da 404 con index.html de cuerpo).
  ['/ruta-que-no-existe-seo-smoke', 'vendix.online', {}, '/ruta-que-no-existe-seo-smoke'],
  ['/blog', 'vendix.online', {}, '/blog'],
  ['/pricingx', 'vendix.online', {}, '/pricingx'],
  ['/administrador', 'vendix.online', {}, '/administrador'],
  ['/pricing', 'vendix.online', { utm_source: { value: 'ig' } }, '/index.html'],
  ['/pricing/', 'vendix.online', {}, '/index.html'],
  // SEO-TECH-02: la portada comercial se sirve prerenderizada, también con UTM (la query no cambia la URI).
  ['/', 'vendix.online', {}, '/marketing/index.html'],
  ['/', 'vendix.online', { utm_source: { value: 'ig' } }, '/marketing/index.html'],
  ['/', 'VENDIX.ONLINE', {}, '/marketing/index.html'],
  ['/index.html', 'vendix.online', {}, '/index.html'],
  ['/ayuda', 'vendix.online', {}, '/noindex/index.html'],
  ['/pqr/consultar/T-123', 'vendix.online', {}, '/noindex/index.html'],
  ['/pqr/gracias/T-123', 'vendix.online', {}, '/noindex/index.html'],
  ['/legal/cookies', 'vendix.online', {}, '/index.html'],
  ['/guias/cierre-de-caja', 'vendix.online', {}, '/index.html'],
  ['/auth/login', 'vendix.online', {}, '/noindex/index.html'],
  ['/auth/verify-email', 'vendix.online', { token: { value: 'x' } }, '/noindex/index.html'],
  ['/admin/dashboard', 'vendix.online', {}, '/noindex/index.html'],
  ['/super-admin/dashboard', 'vendix.online', {}, '/noindex/index.html'],
  ['/superadmin/dashboard', 'vendix.online', {}, '/noindex/index.html'],
  ['/repartos/pool', 'vendix.online', {}, '/noindex/index.html'],
  ['/onboarding', 'vendix.online', {}, '/noindex/index.html'],
  ['/reset-password', 'vendix.online', { token: { value: 'x' } }, '/noindex/index.html'],
  // SEO-TECH-04 arriba: ayuda, PQR, auth y paneles reciben la shell con noindex en el HTML.
  // Los prefijos de tienda siguen reescribiéndose en cualquier host (enlaces con token).
  ['/pedido/0b6f5c1e', 'vendix.online', {}, '/index.html'],
  // En tiendas no cambia nada: Angular decide.
  ['/ruta-que-no-existe-seo-smoke', 'tienda-demo.vendix.online', {}, '/index.html'],
  ['/ruta-que-no-existe-seo-smoke', 'mesura.beauty', {}, '/index.html'],
];

for (const [uri, host, qs, expected] of cases) {
  assert.strictEqual(result(handler(event(uri, host, qs))), expected, `${host}${uri}`);
}
console.log(`ok ${cases.length} casos`);

// SEO-TECH-02: solo GET/HEAD reciben el HTML comercial; otro método sigue con la shell neutra.
assert.strictEqual(result(handler(event('/', 'vendix.online', {}, 'HEAD'))), '/marketing/index.html');
assert.strictEqual(result(handler(event('/', 'vendix.online', {}, 'POST'))), '/index.html');
// Las tiendas nunca reciben la landing de Vendix.
for (const host of ['tienda-demo.vendix.online', 'mesura.beauty', 'vendix.online.evil.test']) {
  assert.notStrictEqual(result(handler(event('/', host))), '/marketing/index.html');
}
console.log('ok SEO-TECH-02 portada comercial');

// SEO-TECH-04: noindex en el HTML servido. Tiendas (subdominio y dominio propio): las rutas privadas
// o con token reciben /noindex/index.html; las indexables siguen con la shell normal.
const STORE_HOSTS = ['tienda-demo.vendix.online', 'mesura.beauty'];
const storeNoindex = ['/cart', '/cart/', '/checkout', '/account', '/account/orders/42', '/wishlist', '/pedido/0b6f5c1e', '/order/0b6f5c1e',
  '/factura/abc', '/preconsulta/abc', '/pagar/abc', '/seguimiento-servicio/AbC_d-123', '/pre-registro/abc', '/calificar-estadia/abc',
  '/hotel/reserva/7', '/flujos/abc', '/flujos/seguimiento/abc', '/firmar/abc', '/estacion/abc', '/fila', '/fila/volver', '/book/12',
  '/pqr', '/pqr/consultar/T-1', '/reset-password', '/auth/login', '/admin/settings/general/venta', '/super-admin', '/repartos/pool', '/onboarding'];
const storeIndexable = ['/', '/catalog', '/catalog/aceite-1.5l', '/productos/labial-rojo', '/products/x', '/producto/x', '/novedades', '/new',
  '/ofertas', '/sale', '/cartas', '/hotel', '/cartera', '/accounting-tips', '/checkoutx', '/pqrs-info'];
for (const host of STORE_HOSTS) {
  for (const uri of storeNoindex) assert.strictEqual(result(handler(event(uri, host))), '/noindex/index.html', `${host}${uri} noindex`);
  for (const uri of storeIndexable) assert.notStrictEqual(result(handler(event(uri, host))), '/noindex/index.html', `${host}${uri} indexable`);
}
// En vendix.online las páginas comerciales indexables no reciben noindex; los archivos nunca.
for (const uri of ['/', '/pricing', '/legal/terminos', '/legal/privacidad', '/legal/cookies', '/guias/cierre-de-caja', '/ayudax', '/authors'])
  assert.notStrictEqual(result(handler(event(uri, 'vendix.online'))), '/noindex/index.html', `vendix.online${uri}`);
for (const [uri, host] of [['/auth/app.js', 'vendix.online'], ['/cart/logo.png', 'mesura.beauty'], ['/.well-known/x', 'mesura.beauty']])
  assert.notStrictEqual(result(handler(event(uri, host))), '/noindex/index.html', `${host}${uri} archivo`);
// Solo GET/HEAD; un POST sigue con la shell de siempre. www sigue redirigiendo antes.
assert.strictEqual(result(handler(event('/auth/login', 'vendix.online', {}, 'HEAD'))), '/noindex/index.html');
assert.strictEqual(result(handler(event('/auth/login', 'vendix.online', {}, 'POST'))), '/index.html');
assert.strictEqual(result(handler(event('/cart', 'www.mesura.beauty'))), '301 https://mesura.beauty/cart');
console.log('ok SEO-TECH-04 noindex en el HTML servido');
