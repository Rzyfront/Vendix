'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSmoke, parseArgs, TOKEN_RE } = require('./seo-smoke.cjs');

const BASE = 'https://vendix.online';
const NOW = Date.parse('2026-11-03T12:00:00Z');
const SEC = { 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff', 'referrer-policy': 'x', 'x-frame-options': 'DENY', 'cache-control': 'max-age=0' };
const PAGES = [['/', true], ['/pricing', true], ['/ayuda', true], ['/legal/terminos', true], ['/legal/privacidad', true], ['/legal/cookies', true], ['/pqr', false], ['/auth/login', false], ['/auth/register', false]];

function page(p, index) {
  const canon = index ? `<link rel="canonical" href="${BASE}${p}">` : '';
  const robots = index ? 'index, follow' : 'noindex, follow';
  return `<html><head><title>T ${p}</title><meta name="description" content="D ${p}"><meta name="robots" content="${robots}">${canon}</head><body><h1>H</h1><p>${'texto '.repeat(60)}</p></body></html>`;
}
const sitemap = locs => `<urlset>${locs.map(l => `<url><loc>${l}</loc><lastmod>2026-10-01</lastmod></url>`).join('')}</urlset>`;

// Sitio sano. `over` reemplaza entradas: clave "GET url" / "HEAD url" / "url" -> {status, headers, body} o función que lanza.
function site(over = {}) {
  const t = {
    'http://vendix.online/': { status: 301, headers: { location: 'https://vendix.online/' } },
    'https://www.vendix.online/': { status: 301, headers: { location: 'https://vendix.online/' } },
    [BASE + '/precios']: { status: 301, headers: { location: '/pricing' } },
    [BASE + '/robots.txt']: { status: 200, body: `User-agent: *\nDisallow: /api\nSitemap: ${BASE}/sitemap.xml\n` },
    [BASE + '/sitemap.xml']: { status: 200, body: sitemap(PAGES.filter(p => p[1]).map(p => BASE + (p[0] === '/' ? '/' : p[0]))) },
    [BASE + '/llms.txt']: { status: 404 },
  };
  for (const [p, i] of PAGES) t[BASE + p] = { status: 200, headers: { 'content-type': 'text/html', ...SEC }, body: page(p, i) };
  return { ...t, ...over };
}
function fakeFetch(table, log = []) {
  return async (url, o = {}) => {
    log.push((o.method || 'GET') + ' ' + url);
    const e = table[(o.method || 'GET') + ' ' + url] || table[url] || { status: 404, body: 'no' };
    if (typeof e === 'function') return e();
    const body = [204, 304].includes(e.status) || o.method === 'HEAD' ? null : (e.body ?? '');
    return new Response(body, { status: e.status, headers: { ...(e.status === 200 || e.headers ? SEC : {}), ...(e.headers || {}) } });
  };
}
const exec = (table, opts = {}, log) => createSmoke({ base: BASE, fetch: fakeFetch(table, log), now: () => NOW, ...opts }).run();
const find = (r, id) => r.results.find(x => x.id === id);

test('sitio sano: los controles nuevos pasan', async () => {
  const r = await exec(site());
  for (const id of ['www-apex', 'precios-pricing', 'robots-200', 'sitemap-200', 'sitemap-hosts', 'sitemap-tokens']) assert.equal(find(r, id).status, 'OK', id);
});

test('(c) archivo inexistente: 404 pasa y 200 (soft 404) falla', async () => {
  assert.equal(find(await exec(site()), 'archivo-404').status, 'OK');
  const bad = await exec(site({ [BASE + '/no-existe-' + NOW + '.js']: { status: 200, body: '<html>' } }));
  assert.equal(find(bad, 'archivo-404').status, 'FALLA');
  assert.ok(find(bad, 'archivo-404').url.endsWith('/no-existe-' + NOW + '.js'));
});

test('(a) www sin redirigir (200) falla', async () => {
  const r = await exec(site({ 'https://www.vendix.online/': { status: 200, body: 'x' } }));
  assert.equal(find(r, 'www-apex').status, 'FALLA');
});

test('(a) www con 302 o con destino ajeno falla', async () => {
  assert.equal(find(await exec(site({ 'https://www.vendix.online/': { status: 302, headers: { location: BASE + '/' } } })), 'www-apex').status, 'FALLA');
  assert.equal(find(await exec(site({ 'https://www.vendix.online/': { status: 301, headers: { location: 'https://otro.com/' } } })), 'www-apex').status, 'FALLA');
});

test('(a) más de un salto (el apex vuelve a redirigir) falla', async () => {
  const r = await exec(site({ 'HEAD https://vendix.online/': { status: 301, headers: { location: 'https://vendix.online/home' } } }));
  assert.equal(find(r, 'www-apex').status, 'FALLA');
  assert.match(find(r, 'www-apex').observed, /más de un salto/);
});

test('(b) /precios con 200 falla; con 302 falla; con 301 a /pricing pasa', async () => {
  assert.equal(find(await exec(site({ [BASE + '/precios']: { status: 200, body: 'x' } })), 'precios-pricing').status, 'FALLA');
  assert.equal(find(await exec(site({ [BASE + '/precios']: { status: 302, headers: { location: '/pricing' } } })), 'precios-pricing').status, 'FALLA');
  assert.equal(find(await exec(site({ [BASE + '/precios']: { status: 301, headers: { location: BASE + '/pricing' } } })), 'precios-pricing').status, 'OK');
});

test('(d) robots.txt y sitemap.xml con 404 fallan', async () => {
  const r = await exec(site({ [BASE + '/robots.txt']: { status: 404 }, [BASE + '/sitemap.xml']: { status: 404 } }));
  assert.equal(find(r, 'robots-200').status, 'FALLA');
  assert.equal(find(r, 'sitemap-200').status, 'FALLA');
});

test('(d) sitemap con host ajeno falla y no pide esa URL', async () => {
  const log = [];
  const r = await exec(site({ [BASE + '/sitemap.xml']: { status: 200, body: sitemap([BASE + '/', 'https://evil.example/x']) } }), {}, log);
  assert.equal(find(r, 'sitemap-hosts').status, 'FALLA');
  assert.ok(!log.some(l => l.includes('evil.example')));
});

test('(d) sitemap con URL de token falla, no se pide y no se imprime', async () => {
  const tokenUrl = BASE + '/' + 'pedi' + 'do/abc123';
  const log = [];
  const r = await exec(site({ [BASE + '/sitemap.xml']: { status: 200, body: sitemap([BASE + '/', tokenUrl]) } }), {}, log);
  assert.equal(find(r, 'sitemap-tokens').status, 'FALLA');
  assert.ok(!log.some(l => l.includes('abc123')));
  assert.ok(!JSON.stringify(r).includes('abc123'));
});

test('TOKEN_RE reconoce los tres segmentos y no confunde prefijos', () => {
  for (const s of ['pedido', 'order', 'factura']) assert.ok(TOKEN_RE.test('https://x.co/' + s + '/1'));
  assert.ok(!TOKEN_RE.test('https://x.co/pedidos-info'));
});

test('modo report: hay FALLA pero el código de salida es 0', async () => {
  const r = await exec(site({ 'https://www.vendix.online/': { status: 200, body: 'x' } }), { mode: 'report' });
  assert.ok(r.summary.falla > 0);
  assert.equal(r.exitCode, 0);
  assert.equal(find(r, 'www-apex').enforced, false);
});

test('modo enforce: la misma FALLA da código 1', async () => {
  const r = await exec(site({ 'https://www.vendix.online/': { status: 200, body: 'x' } }), { mode: 'enforce' });
  assert.equal(r.exitCode, 1);
});

test('report + enforce de un control concreto: solo ese bloquea', async () => {
  const t = site({ 'https://www.vendix.online/': { status: 200, body: 'x' } });
  assert.equal((await exec(t, { mode: 'report', enforceIds: ['precios-pricing'] })).exitCode, 0);
  assert.equal((await exec(t, { mode: 'report', enforceIds: ['www-apex'] })).exitCode, 1);
});

test('sitio sano en enforce: código 0 y ninguna FALLA', async () => {
  const r = await exec(site(), { mode: 'enforce' });
  assert.equal(r.summary.falla, 0, JSON.stringify(r.results.filter(x => x.status === 'FALLA')));
  assert.equal(r.exitCode, 0);
});

test('un error de red en un control se registra como FALLA y el resto sigue', async () => {
  const r = await exec(site({ 'https://www.vendix.online/': () => { throw new Error('ECONNRESET'); } }));
  assert.ok(r.results.some(x => x.status === 'FALLA' && /ECONNRESET/.test(x.observed)));
  assert.equal(find(r, 'robots-200').status, 'OK');
});

test('JSON: url, status, location, métricas, ok y hash del body', async () => {
  const r = await exec(site());
  const x = find(r, 'robots-200');
  assert.equal(x.url, BASE + '/robots.txt');
  assert.equal(x.httpStatus, 200);
  assert.equal(x.ok, true);
  assert.match(x.bodyHash, /^[0-9a-f]{64}$/);
  assert.equal(typeof x.ms, 'number');
  assert.ok(x.bytes > 0);
  assert.equal(find(r, 'precios-pricing').location, '/pricing');
});

test('en una tienda no se evalúan www-apex ni precios-pricing', async () => {
  const store = 'https://vendix-pit-and-grill-shop.vendix.online';
  const table = { [store + '/robots.txt']: { status: 200, body: 'Sitemap: ' + store + '/sitemap.xml' }, [store + '/sitemap.xml']: { status: 200, body: sitemap([store + '/']) } };
  const r = await createSmoke({ base: store, fetch: fakeFetch(table), now: () => NOW }).run();
  assert.equal(find(r, 'www-apex'), undefined);
  assert.equal(find(r, 'precios-pricing'), undefined);
  assert.equal(find(r, 'sitemap-hosts').status, 'OK');
});

test('parseArgs: default report, flag, env y modo inválido', () => {
  assert.equal(parseArgs([], {}).mode, 'report');
  assert.equal(parseArgs([], { SEO_SMOKE_MODE: 'enforce' }).mode, 'enforce');
  assert.equal(parseArgs(['https://a.co', '--mode', 'report', '--json', 'o.json'], { SEO_SMOKE_MODE: 'enforce' }).mode, 'report');
  assert.equal(parseArgs(['https://a.co'], {}).base, 'https://a.co');
  assert.throws(() => parseArgs(['--mode', 'x'], {}));
});
