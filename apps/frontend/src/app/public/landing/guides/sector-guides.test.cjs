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
const GUIDE_KEYS = ['comandas-restaurantes', 'ventas-mayoristas-al-detal', 'preparar-demostracion', 'cierre-de-caja', 'control-de-inventario'];
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
