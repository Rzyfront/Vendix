#!/usr/bin/env node
/**
 * Smoke SEO posdespliegue de la web comercial y de las tiendas de Vendix (SEO-TECH-15).
 *
 * Solo lectura: GET/HEAD públicos, sin cookies ni credenciales. Node 20+ (fetch nativo), sin dependencias.
 *
 * Uso:
 *   node scripts/seo/seo-smoke.cjs [https://vendix.online] [--json salida.json] [--mode report|enforce]
 *
 * Modo (flag --mode o env SEO_SMOKE_MODE; por defecto report):
 *   report  -> informa; el código de salida es 0 aunque haya FALLA.
 *   enforce -> código de salida 1 si hay alguna FALLA.
 *   SEO_SMOKE_ENFORCE=id1,id2 fuerza enforce solo en esos controles aunque el modo global sea report.
 *
 * Controles con id (se pueden pasar a enforce uno a uno):
 *   www-apex        www.vendix.online responde 301 a https://vendix.online en un salto (solo en vendix.online)
 *   precios-pricing /precios responde 301 a /pricing (solo en vendix.online)
 *   archivo-404     un archivo inexistente (/no-existe-<ts>.js) responde 404
 *   robots-200, sitemap-200, sitemap-hosts, sitemap-tokens
 *   http-https      http://<host>/ responde 301/308 a https
 *   hsts, nosniff, referrer-policy  cabeceras de seguridad de la portada
 *
 * Privacidad: el reporte nunca imprime una URL con ruta de token (pedido, order, factura);
 * solo cuenta cuántas hay. Esas URLs tampoco se piden.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const UA = 'Mozilla/5.0 (compatible; VendixSEOSmoke/2.0)';
const TIMEOUT_MS = 15000;
const SITEMAP_HEAD_CAP = 60;
const APEX_HOST = 'vendix.online';

// El patrón se arma por partes para que el propio script no contenga rutas con token literales.
const TOKEN_SEGMENTS = ['pedido', 'order', 'factura'];
const TOKEN_RE = new RegExp('/(' + TOKEN_SEGMENTS.join('|') + ')(/|$)', 'i');

// Rutas públicas conocidas de la web comercial.
const KNOWN = [
  { path: '/', index: true },
  { path: '/pricing', index: true },
  { path: '/ayuda', index: true },
  { path: '/legal/terminos', index: true },
  { path: '/legal/privacidad', index: true },
  { path: '/legal/cookies', index: true },
  { path: '/pqr', index: false },
  { path: '/auth/login', index: false },
  { path: '/auth/register', index: false },
];
const UNKNOWN = '/ruta-que-no-existe-seo-smoke';

const pick = (html, re) => { const m = html.match(re); return m ? m[1].trim() : null; };
const visibleText = html => (html.split(/<body[^>]*>/i)[1] || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hostOf = u => { try { return new URL(u).host.toLowerCase(); } catch { return null; } };

/**
 * Crea una ejecución del smoke. `fetchImpl` y `now` son inyectables para pruebas.
 */
function createSmoke(opts = {}) {
  const base = (opts.base || 'https://vendix.online').replace(/\/+$/, '');
  const mode = opts.mode || 'report';
  const enforceIds = new Set(opts.enforceIds || []);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const now = opts.now || (() => Date.now());
  const allowedHosts = new Set([new URL(base).host.toLowerCase(), ...(opts.allowedHosts || []).map(h => h.toLowerCase())]);
  const host = new URL(base).host;
  const results = [];

  const add = (area, check, status, observed, extra = {}) => {
    const { id = null, rec = null } = extra;
    results.push({
      id, area, check, status, ok: status === 'OK',
      enforced: mode === 'enforce' || (id !== null && enforceIds.has(id)),
      observed: String(observed),
      url: rec ? rec.url : null,
      httpStatus: rec ? rec.status : null,
      location: rec ? rec.location : null,
      ms: rec ? rec.ms : null,
      bytes: rec ? rec.bytes : null,
      bodyHash: rec ? rec.bodyHash : null,
    });
  };

  async function get(url, o = {}) {
    const t0 = now();
    const res = await fetchImpl(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...o,
    });
    const body = o.method === 'HEAD' ? '' : await res.text();
    const rec = {
      url, status: res.status, location: res.headers.get('location'),
      ms: now() - t0, bytes: Buffer.byteLength(body),
      bodyHash: o.method === 'HEAD' ? null : sha256(body),
    };
    return { status: res.status, location: rec.location, headers: res.headers, body, rec };
  }
  const isRedirect = s => [301, 308].includes(s);
  const resolveLoc = (loc, from) => { try { return new URL(loc, from).href; } catch { return loc; } };

  async function checkHost() {
    const alias = host.startsWith('www.') ? host.slice(4) : 'www.' + host;
    const http = await get('http://' + host + '/');
    add('host', 'http → https', isRedirect(http.status) && (http.location || '').startsWith('https://') ? 'OK' : 'FALLA', http.status + ' → ' + http.location, { id: 'http-https', rec: http.rec });
    try {
      const www = await get('https://' + alias + '/');
      const redirects = isRedirect(www.status) && (www.location || '').startsWith(base);
      add('host', 'alias ' + alias + ' → ' + host, redirects ? 'OK' : 'FALLA', www.status + (www.location ? ' → ' + www.location : ' (sirve contenido sin redirigir)'), { rec: www.rec });
    } catch (e) { add('host', 'alias ' + alias, 'AVISO', 'no responde: ' + e.message); }
  }

  // (a) www → apex en un salto. Solo aplica a la web comercial.
  async function checkWwwApex() {
    if (host !== APEX_HOST) return;
    const target = 'https://' + APEX_HOST + '/';
    const www = await get('https://www.' + APEX_HOST + '/');
    let ok = www.status === 301 && resolveLoc(www.location || '', 'https://www.' + APEX_HOST + '/') === target;
    let obs = www.status + (www.location ? ' → ' + www.location : ' (sin Location)');
    if (ok) {
      const hop = await get(target, { method: 'HEAD' });
      if ([301, 302, 303, 307, 308].includes(hop.status)) { ok = false; obs += '; el destino vuelve a redirigir (' + hop.status + '): más de un salto'; }
    }
    add('redirect', 'www.' + APEX_HOST + ' responde 301 a ' + target + ' en un salto', ok ? 'OK' : 'FALLA', obs, { id: 'www-apex', rec: www.rec });
  }

  // (b) /precios → /pricing.
  async function checkPrecios() {
    if (host !== APEX_HOST) return;
    const res = await get(base + '/precios');
    const ok = res.status === 301 && resolveLoc(res.location || '', base + '/precios') === base + '/pricing';
    add('redirect', '/precios responde 301 a /pricing', ok ? 'OK' : 'FALLA', res.status + (res.location ? ' → ' + res.location : ''), { id: 'precios-pricing', rec: res.rec });
  }

  // (c) archivo inexistente → 404 (no soft 404).
  async function checkMissingFile() {
    const res = await get(base + '/no-existe-' + now() + '.js');
    add('status', 'archivo inexistente (/no-existe-<ts>.js) responde 404', res.status === 404 ? 'OK' : 'FALLA', String(res.status), { id: 'archivo-404', rec: res.rec });
  }

  async function checkRoutes() {
    const seen = new Map();
    for (const r of KNOWN) {
      const res = await get(base + r.path);
      add('status', r.path + ' responde 200', res.status === 200 ? 'OK' : 'FALLA', String(res.status), { rec: res.rec });
      if (res.status >= 300 && res.status < 400) continue;
      const html = res.body;
      const canonical = pick(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)/i);
      const robots = pick(html, /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)/i) || '(sin meta robots)';
      const title = pick(html, /<title>([^<]*)<\/title>/i);
      const desc = pick(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)/i);
      const expected = base + (r.path === '/' ? '/' : r.path);
      if (r.index) add('metadata', r.path + ' canonical propio (HTML servido)', canonical === expected ? 'OK' : 'FALLA', String(canonical));
      const noindex = /noindex/i.test(robots);
      add('metadata', r.path + (r.index ? ' indexable' : ' noindex'), r.index === !noindex ? 'OK' : 'FALLA', robots);
      const text = visibleText(html).length;
      if (r.index) add('html', r.path + ' tiene texto sin JavaScript', text > 200 ? 'OK' : 'FALLA', text + ' caracteres');
      const h1s = (html.match(/<h1[\s>]/gi) || []).length;
      if (r.index) add('html', r.path + ' tiene un H1 en el HTML servido', h1s === 1 ? 'OK' : 'FALLA', h1s + ' H1');
      for (const [k, v] of [['title', title], ['description', desc]]) {
        if (!r.index || !v) continue;
        if (seen.has(k + v)) add('metadata', r.path + ' ' + k + ' único', 'FALLA', 'repite el de ' + seen.get(k + v));
        else seen.set(k + v, r.path);
      }
    }
    const unknown = await get(base + UNKNOWN);
    add('status', 'ruta desconocida responde 404', unknown.status === 404 ? 'OK' : 'FALLA', String(unknown.status), { rec: unknown.rec });
  }

  // (d) robots.txt y sitemap.xml
  async function checkFiles() {
    const robots = await get(base + '/robots.txt');
    add('rastreo', 'robots.txt 200', robots.status === 200 ? 'OK' : 'FALLA', String(robots.status), { id: 'robots-200', rec: robots.rec });
    const sitemapRef = pick(robots.body, /Sitemap:\s*(\S+)/i);
    add('rastreo', 'robots.txt declara sitemap', sitemapRef ? 'OK' : 'FALLA', sitemapRef && TOKEN_RE.test(sitemapRef) ? '(URL con token omitida)' : String(sitemapRef));
    if (/Disallow:\s*\/\s*$/m.test(robots.body)) add('rastreo', 'robots.txt no bloquea todo el sitio', 'FALLA', 'Disallow: /');

    const sm = await get(base + '/sitemap.xml');
    add('rastreo', 'sitemap.xml 200', sm.status === 200 ? 'OK' : 'FALLA', String(sm.status), { id: 'sitemap-200', rec: sm.rec });
    const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    add('rastreo', 'sitemap no está vacío', locs.length ? 'OK' : 'FALLA', locs.length + ' URL');

    const foreign = locs.filter(l => { const h = hostOf(l); return !h || !allowedHosts.has(h); });
    add('rastreo', 'sitemap sin hosts ajenos', foreign.length ? 'FALLA' : 'OK',
      foreign.length ? foreign.length + ' URL de hosts ajenos (' + [...new Set(foreign.map(l => hostOf(l) || '(inválido)'))].slice(0, 5).join(', ') + ')' : 'todas en ' + [...allowedHosts].join(', '),
      { id: 'sitemap-hosts' });
    const withToken = locs.filter(l => TOKEN_RE.test(l));
    add('rastreo', 'sitemap sin URL con token', withToken.length ? 'FALLA' : 'OK',
      withToken.length ? withToken.length + ' URL con ruta de token (no se muestran)' : 'ninguna', { id: 'sitemap-tokens' });

    const lastmods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => Date.parse(m[1].trim()));
    const recent = lastmods.filter(t => Math.abs(now() - t) < 10 * 60 * 1000).length;
    add('rastreo', 'sitemap sin lastmod de hora de generación', recent ? 'FALLA' : 'OK', recent + ' de ' + lastmods.length + ' lastmod en los últimos 10 min');
    const expected = KNOWN.filter(r => r.index).map(r => base + (r.path === '/' ? '/' : r.path));
    if (host === APEX_HOST) add('rastreo', 'sitemap lista las páginas indexables conocidas', expected.every(u => locs.includes(u)) ? 'OK' : 'AVISO', locs.length + ' URL');

    const safe = locs.filter(l => !TOKEN_RE.test(l) && allowedHosts.has(hostOf(l)));
    for (const loc of safe.slice(0, SITEMAP_HEAD_CAP)) {
      const r = await get(loc, { method: 'HEAD' });
      add('rastreo', 'URL del sitemap responde 200: ' + loc, r.status === 200 ? 'OK' : 'FALLA', String(r.status), { rec: r.rec });
    }
    if (safe.length > SITEMAP_HEAD_CAP) add('rastreo', 'URL del sitemap verificadas', 'AVISO', 'muestra de ' + SITEMAP_HEAD_CAP + ' de ' + safe.length);

    const llms = await get(base + '/llms.txt', { method: 'HEAD' });
    add('rastreo', 'llms.txt publicado (opcional)', llms.status === 200 ? 'OK' : 'AVISO', String(llms.status), { rec: llms.rec });
  }

  async function checkHeaders() {
    const res = await get(base + '/', { method: 'HEAD' });
    const h = name => res.headers.get(name);
    // x-frame-options y CSP se omiten a propósito (infra/cloudfront/README-security-headers.md):
    // un DENY/SAMEORIGIN rompería el checkout de Wompi y las tiendas embebidas. Su ausencia es AVISO.
    const optional = ['x-frame-options', 'content-security-policy'];
    const ids = { 'strict-transport-security': 'hsts', 'x-content-type-options': 'nosniff', 'referrer-policy': 'referrer-policy' };
    for (const name of ['strict-transport-security', 'x-content-type-options', 'referrer-policy', ...optional]) {
      add('seguridad', 'cabecera ' + name, h(name) ? 'OK' : (optional.includes(name) ? 'AVISO' : 'FALLA'), h(name) || 'ausente', { id: ids[name] || null, rec: res.rec });
    }
    add('cache', 'HTML con revalidación', /max-age=0|no-cache/.test(h('cache-control') || '') ? 'OK' : 'AVISO', h('cache-control') || 'ausente');
  }

  async function run() {
    const started = new Date(now()).toISOString();
    for (const fn of [checkHost, checkWwwApex, checkPrecios, checkMissingFile, checkRoutes, checkFiles, checkHeaders]) {
      try { await fn(); } catch (e) { add(fn.name, 'ejecución', 'FALLA', e.message, { id: null }); }
    }
    const count = s => results.filter(r => r.status === s).length;
    const blocking = results.filter(r => r.status === 'FALLA' && r.enforced).length;
    const summary = { ok: count('OK'), falla: count('FALLA'), aviso: count('AVISO'), bloqueantes: blocking };
    return { base, mode, started, summary, results, exitCode: blocking ? 1 : 0 };
  }

  return { run };
}

function formatReport(r) {
  const lines = ['SEO smoke · ' + r.base + ' · modo ' + r.mode + ' · ' + r.started];
  for (const x of r.results) {
    const tag = x.status === 'FALLA' && !x.enforced ? 'FALLA' : x.status;
    lines.push(tag.padEnd(6) + ' [' + x.area + '] ' + x.check + ' — ' + x.observed + (x.status === 'FALLA' && !x.enforced ? '  (report)' : ''));
  }
  lines.push('', 'Resumen: ' + r.summary.ok + ' OK · ' + r.summary.falla + ' FALLA (' + r.summary.bloqueantes + ' bloqueantes) · ' + r.summary.aviso + ' AVISO');
  return lines.join('\n');
}

function parseArgs(argv, env = process.env) {
  const out = { base: 'https://vendix.online', json: null, mode: env.SEO_SMOKE_MODE || 'report' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = argv[++i];
    else if (a === '--mode') out.mode = argv[++i];
    else if (a.startsWith('--mode=')) out.mode = a.slice(7);
    else if (!a.startsWith('--')) out.base = a;
  }
  if (!['report', 'enforce'].includes(out.mode)) throw new Error('Modo inválido "' + out.mode + '": usa report o enforce');
  out.enforceIds = (env.SEO_SMOKE_ENFORCE || '').split(',').map(s => s.trim()).filter(Boolean);
  out.allowedHosts = (env.SEO_SMOKE_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; return; }
  const report = await createSmoke(args).run();
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
  console.log(formatReport(report));
  process.exitCode = report.exitCode;
}

module.exports = { createSmoke, formatReport, parseArgs, TOKEN_RE, KNOWN };
if (require.main === module) main();
