#!/usr/bin/env node
// Lock-only validation: no registry access and no installed dependencies needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const LOCKS = ['package-lock.json', 'apps/backend/package-lock.json',
  'apps/frontend/package-lock.json', 'apps/mobile/package-lock.json'];
const PACKAGES = ['proxy-addr', '@modelcontextprotocol/sdk', 'source-map-js', 'compression',
  'postcss', 'js-yaml', 'postcss-selector-parser', 'image-size', 'decode-uri-component',
  'sprintf-js', 'braces', 'http-cache-semantics', 'node-forge'];
const EXPIRES = '2026-11-08';

function read(file) { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function copies(lock, name) {
  return Object.entries(lock.packages).filter(([key]) => key.endsWith('node_modules/' + name));
}
function versions(lock, name) { return [...new Set(copies(lock, name).map(([, value]) => value.version))].sort(); }
function resolve(packages, from, name) {
  let current = from;
  while (true) {
    const candidate = path.posix.join(current, 'node_modules', name);
    const entry = packages[candidate];
    if (entry) return entry.link ? entry.resolved : candidate;
    if (!current) return undefined;
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
}
function packageName(key, entry) {
  if (entry.name) return entry.name;
  return key.split('node_modules/').at(-1);
}
function dependencyGraph(lock, starts) {
  const packages = lock.packages;
  const seen = new Set();
  const records = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const value = packages[key];
    assert.ok(value, 'Missing dependency graph node: ' + key);
    const identity = `${packageName(key, value)}@${value.version || ''}`;
    records.add(JSON.stringify([identity, value.integrity || '', value.resolved || '']));
    // Peer and optional edges may be absent; dependency edges must be present.
    const deps = { ...value.peerDependencies, ...value.optionalDependencies, ...value.dependencies };
    for (const name of Object.keys(deps || {}).sort()) {
      const target = resolve(packages, key, name);
      if (!target) {
        assert.ok(!value.dependencies?.[name] || value.optionalDependencies?.[name],
          `Unresolved dependency ${identity} -> ${name}`);
        continue;
      }
      const dependency = packages[target];
      records.add(JSON.stringify([identity, name, `${packageName(target, dependency)}@${dependency.version || ''}`]));
      visit(target);
    }
  }
  starts.forEach(visit);
  return [...records].sort();
}
function checkCopies(lock, name, expected) {
  assert.deepEqual(versions(lock, name), expected.slice().sort(), 'Unexpected versions for ' + name);
  for (const [key, entry] of copies(lock, name)) {
    assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), 'Missing registry URL: ' + key);
    assert.match(entry.integrity || '', /^sha512-/, 'Missing integrity: ' + key);
  }
}
function checkBaseline(baseline, currentRoot) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const previousRoot = JSON.parse(git('show', baseline + ':package-lock.json'));
  const starts = ['apps/mobile', 'node_modules/@shopify/react-native-skia'];
  assert.deepEqual(dependencyGraph(currentRoot, starts), dependencyGraph(previousRoot, starts),
    'A root-lock change affected an excluded mobile dependency chain');
  const mobileChanges = git('diff', '--name-only', baseline, '--', 'apps/mobile', '.github/workflows/ci.yml');
  assert.equal(mobileChanges.trim(), '', 'Mobile files or existing ci.yml changed');
  const previous = JSON.parse(git('show', baseline + ':package.json')).overrides;
  const current = read('package.json').overrides;
  for (const [name, value] of Object.entries(previous)) {
    if (name === '@angular/build') {
      for (const [child, rule] of Object.entries(value)) assert.deepEqual(current[name]?.[child], rule);
    } else assert.deepEqual(current[name], value, 'Existing override changed: ' + name);
  }
  const allowed = new Set(['express', '@nestjs/swagger', '@angular/cli', 'tailwindcss',
    'postcss-nested', '@tailwindcss/typography']);
  for (const name of Object.keys(current)) {
    assert.ok(name in previous || allowed.has(name), 'Unapproved root override: ' + name);
  }
  console.log('PASS: mobile dependency graph, mobile files, ci.yml and existing overrides unchanged');
}
function main() {
  const locks = LOCKS.map(read);
  const [root, backend, frontend, mobile] = locks;
  for (const lock of [root, backend, frontend]) checkCopies(lock, 'proxy-addr', ['2.0.8']);
  for (const lock of [root, frontend]) {
    checkCopies(lock, '@modelcontextprotocol/sdk', ['1.31.0']);
    checkCopies(lock, 'postcss-selector-parser', ['7.1.6']);
  }
  checkCopies(frontend, 'source-map-js', ['1.2.2']);
  checkCopies(root, 'source-map-js', ['1.2.1']); // Explicit pending shared web/mobile copy.
  checkCopies(frontend, 'postcss', ['8.5.28']);
  checkCopies(root, 'postcss', ['8.4.49', '8.5.28']); // Expo remains out of scope.
  checkCopies(root, 'js-yaml', ['3.15.2', '4.3.2', '5.4.1']);
  checkCopies(backend, 'js-yaml', ['4.3.2', '5.4.1']);
  for (const lock of [root, backend]) {
    const swagger = resolve(lock.packages, 'node_modules/@nestjs/swagger', 'js-yaml');
    assert.equal(lock.packages[swagger]?.version, '5.4.1', 'Swagger YAML not patched');
  }
  const istanbul = resolve(backend.packages, 'node_modules/@istanbuljs/load-nyc-config', 'js-yaml');
  assert.equal(backend.packages[istanbul]?.version, '4.3.2');
  checkCopies(backend, 'sprintf-js', []);
  checkCopies(frontend, 'sprintf-js', []);
  for (const lock of [root, mobile]) {
    checkCopies(lock, 'compression', ['1.8.1']);
    checkCopies(lock, 'image-size', ['1.2.1']);
    checkCopies(lock, 'decode-uri-component', ['0.2.2']);
    checkCopies(lock, 'sprintf-js', ['1.0.3']);
  }
  for (const lock of locks) {
    for (const [name, version] of Object.entries({ 'node-forge': '1.4.0', braces: '3.0.3', 'http-cache-semantics': '4.2.0' })) {
      if (copies(lock, name).length) checkCopies(lock, name, [version]);
    }
  }
  assert.ok(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()) <= EXPIRES,
    'Security exceptions have expired: renew explicitly or remediate before ' + EXPIRES);
  const baselineIndex = process.argv.indexOf('--baseline');
  if (baselineIndex !== -1) {
    assert.ok(process.argv[baselineIndex + 1], '--baseline requires a git ref');
    checkBaseline(process.argv[baselineIndex + 1], root);
  }
  console.log('| package | root | backend | frontend | mobile (read-only) |');
  for (const name of PACKAGES) console.log(`| ${name} | ${locks.map((lock) => versions(lock, name).join(', ') || '—').join(' | ')} |`);
  console.log('PASS: approved lock policy (NOT zero vulnerabilities or runtime validation)');
  console.log('PENDING: root web source-map-js; root backend sprintf-js. OUT OF SCOPE: mobile-only chains.');
  console.log('ACCEPTED: node-forge, braces, http-cache-semantics; expires ' + EXPIRES);
}
if (require.main === module) main();
module.exports = { resolve, dependencyGraph, versions, checkCopies };
