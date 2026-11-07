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
test('guide routes are gated and absent from other public app route files', () => {
  const routes = path.resolve(front, 'app/routes/public');
  const marketing = fs.readFileSync(path.join(routes, 'vendix_landing.public.routes.ts'), 'utf8');
  for (const key of GUIDE_KEYS) assert.match(marketing, new RegExp("'" + key + "'"));
  assert.match(marketing, /sectorGuideRoutes:\s*Routes\s*=\s*SECTOR_GUIDES_ENABLED\s*\?/);
  for (const file of fs.readdirSync(routes).filter(f => f.endsWith('.ts') && f !== 'vendix_landing.public.routes.ts')) {
    assert.doesNotMatch(fs.readFileSync(path.join(routes, file), 'utf8'), /sectorGuideRoutes|sector-guide\.component/);
  }
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
test('new guide routes stay inside the gated ternary', () => {
  const routes = path.resolve(front, 'app/routes/public/vendix_landing.public.routes.ts');
  const src = fs.readFileSync(routes, 'utf8');
  const gated = src.slice(src.indexOf('= SECTOR_GUIDES_ENABLED'), src.indexOf('  : [];'));
  for (const key of ['elegir-software-pos', 'pasar-productos-excel-a-pos']) assert.ok(gated.includes("'" + key + "'"));
});
