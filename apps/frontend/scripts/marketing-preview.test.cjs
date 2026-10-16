'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { marketingObjectKey } = require('./marketing-host-selector.cjs');
const root = path.resolve(__dirname, '..');
test('core root GET and HEAD select a separate object', () => {
  for (const host of ['vendix.online', 'www.vendix.online', 'VENDIX.ONLINE'])
    for (const method of ['GET', 'HEAD']) assert.equal(marketingObjectKey(host, '/', method), '/marketing/index.html');
});
test('tenants, custom domains, ports and misleading suffixes fail closed', () => {
  for (const host of ['', null, 'tienda.vendix.online', 'vendix.online.evil.test', 'evilvendix.online', 'roma.example', 'vendix.online:443', 'vendix.online.', ' vendix.online'])
    assert.equal(marketingObjectKey(host, '/'), null);
});
test('auth, admin, assets, encoded and unknown paths preserve existing routing', () => {
  for (const uri of ['/auth/login', '/admin', '/super-admin', '/api', '/index.html', '/guias/comandas-restaurantes', '/legal/terminos', '//', '/%2f', '/?utm_source=test', null])
    assert.equal(marketingObjectKey('vendix.online', uri), null);
  assert.equal(marketingObjectKey('vendix.online', '/', 'POST'), null);
});
test('alternating hosts never shares marketing and tenant keys', () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(marketingObjectKey('vendix.online', '/'), '/marketing/index.html');
    assert.equal(marketingObjectKey('tenant.vendix.online', '/'), null);
  }
});
test('production keeps its neutral server entry and preview is opt-in', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'angular.json'), 'utf8'));
  const build = config.projects.vendix.architect.build;
  assert.equal(build.configurations.production.server, 'src/main.server.ts');
  assert.equal(build.configurations['marketing-preview'].server, 'src/main.marketing-preview.server.ts');
  assert.notEqual(build.configurations['marketing-preview'].outputPath, build.configurations.production.outputPath);
  const html = fs.readFileSync(path.join(root, 'src/index.marketing-preview.html'), 'utf8');
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /<app-root ngSkipHydration>/);
  assert.doesNotMatch(html, /vendix-prerender-hidden/);
});
