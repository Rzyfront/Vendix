const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const dir = __dirname;
const front = path.resolve(dir, '../../../..');
const load = () => {
  const src = fs.readFileSync(path.join(dir, 'sector-guides.content.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
  const context = { exports: {} }; vm.runInNewContext(js, context);
  return context.exports.SECTOR_GUIDES;
};
test('preview gate is off in production and on in local development', () => {
  const prod = fs.readFileSync(path.join(front, 'environments/environment.ts'), 'utf8');
  const dev = fs.readFileSync(path.join(front, 'environments/environment.development.ts'), 'utf8');
  assert.match(prod, /sectorGuidesEnabled:\s*false/);
  assert.match(dev, /sectorGuidesEnabled:\s*true/);
});
const GUIDE_KEYS = ['comandas-restaurantes', 'ventas-mayoristas-al-detal', 'preparar-demostracion', 'cierre-de-caja', 'control-de-inventario', 'elegir-software-pos', 'pasar-productos-excel-a-pos'];
test('every route fixture resolves to complete editorial content', () => {
  const guides = load();
  assert.deepEqual(Object.keys(guides).sort(), [...GUIDE_KEYS].sort());
  for (const key of GUIDE_KEYS) {
    assert.ok(guides[key].title && guides[key].description);
    assert.ok(guides[key].sections.length >= 4);
    assert.ok(guides[key].checklist.length >= 6);
    for (const s of guides[key].sections) assert.ok(s.heading && s.paragraphs.length);
  }
});
test('landing entry links all point to existing guide fixtures', () => {
  const guides = load();
  const html = fs.readFileSync(path.join(dir, 'sector-guides.component.html'), 'utf8');
  const keys = [...html.matchAll(/routerLink="\/guias\/([^\"]+)"/g)].map(m => m[1]);
  assert.equal(keys.length, 3);
  for (const key of keys) assert.ok(guides[key]);
});
test('Angular parses both templates with no syntax errors', async () => {
  const { parseTemplate } = await import('@angular/compiler');
  for (const filename of ['sector-guide.component.html', 'sector-guides.component.html']) {
    const parsed = parseTemplate(fs.readFileSync(path.join(dir, filename), 'utf8'), filename);
    assert.equal(parsed.errors, null, JSON.stringify(parsed.errors));
  }
});
const configSrc = () => fs.readFileSync(path.join(dir, 'sector-guides.config.ts'), 'utf8');
const listIn = (src, name) => {
  const m = src.match(new RegExp('export const ' + name + '[^=]*=\\s*\\[([^\\]]*)\\]'));
  assert.ok(m, name + ' list not found');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
};
test('guide routes come from the config gate and are absent from other public app route files', () => {
  const routes = path.resolve(front, 'app/routes/public');
  const marketing = fs.readFileSync(path.join(routes, 'vendix_landing.public.routes.ts'), 'utf8');
  assert.match(marketing, /sectorGuideRoutes:\s*Routes\s*=\s*ROUTED_SECTOR_GUIDES\.map\(/);
  assert.deepEqual(listIn(configSrc(), 'SECTOR_GUIDE_KEYS').sort(), [...GUIDE_KEYS].sort());
  for (const file of fs.readdirSync(routes).filter(f => f.endsWith('.ts') && f !== 'vendix_landing.public.routes.ts')) {
    assert.doesNotMatch(fs.readFileSync(path.join(routes, file), 'utf8'), /sectorGuideRoutes|sector-guide\.component/);
  }
});
test('production routes only the published pilot guides (SEO-OPS-36)', () => {
  const src = configSrc();
  assert.match(src, /ROUTED_SECTOR_GUIDES[^=]*=\s*SECTOR_GUIDES_ENABLED\s*\?\s*SECTOR_GUIDE_KEYS\s*:\s*PUBLISHED_SECTOR_GUIDES/);
  const published = listIn(src, 'PUBLISHED_SECTOR_GUIDES');
  assert.deepEqual(published, ['comandas-restaurantes', 'ventas-mayoristas-al-detal', 'pasar-productos-excel-a-pos', 'preparar-demostracion', 'cierre-de-caja', 'control-de-inventario', 'elegir-software-pos']);
  for (const key of published) assert.ok(GUIDE_KEYS.includes(key));
  const repo = path.resolve(front, '../../..');
  const sitemap = fs.readFileSync(path.join(repo, 'apps/backend/src/domains/public/seo/marketing-sitemap.registry.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(repo, 'scripts/seo/seo-smoke.cjs'), 'utf8');
  const sitemapGuides = [...sitemap.matchAll(/path: '\/guias\/([a-z-]+)'/g)].map((m) => m[1]);
  assert.deepEqual(sitemapGuides, published, 'sitemap lists exactly the published guides');
  for (const key of published) assert.match(smoke, new RegExp("path: '/guias/" + key + "', index: true"));
});
test('published guides carry a dated proof and no draft label', () => {
  const guides = load();
  for (const key of listIn(configSrc(), 'PUBLISHED_SECTOR_GUIDES')) {
    assert.match(JSON.stringify(guides[key]), /de (octubre|noviembre) de 2026/, key + ' needs a dated proof');
  }
  const html = fs.readFileSync(path.join(dir, 'sector-guide.component.html'), 'utf8');
  assert.match(html, /@if \(!published\(\)\)\s*\{\s*<p class="preview-label">/);
  assert.doesNotMatch(html, /routerLink="\/guias\/[a-z-]+"/, 'related links must come from routed guides');
});
test('all seven guides exist and avoid unverified or forbidden claims', () => {
  const guides = load();
  assert.equal(Object.keys(guides).length, 7);
  const forbidden = [/sin tarjeta/i, /gratuita/i, /siigo/i, /alegra/i, /offline/i, /sin conexi[oó]n/i];
  const forbiddenNew = [/sin perder/i, /n[oó]mina/i, /empleados/i, /POR CONFIRMAR/i, /\/contacto/, /\/recursos\//];
  for (const key of GUIDE_KEYS) {
    const g = guides[key];
    assert.ok(g.description.length <= 155, key + ' description too long');
    const text = JSON.stringify(g);
    for (const re of forbidden) assert.doesNotMatch(text, re, key + ' ' + re);
    if (['elegir-software-pos', 'pasar-productos-excel-a-pos'].includes(key)) for (const re of forbiddenNew) assert.doesNotMatch(text, re, key + ' ' + re);
    if (/Empresarial Pro/.test(text)) assert.match(text, /IA Business/, key);
    for (const m of text.matchAll(/\/guias\/[a-z-]+/g)) assert.ok(guides[m[0].slice(7)], 'broken link ' + m[0]);
  }
});
