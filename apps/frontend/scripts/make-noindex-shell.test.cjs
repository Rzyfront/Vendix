// node apps/frontend/scripts/make-noindex-shell.test.cjs
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeNoindexShell } = require('./make-noindex-shell.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const out = makeNoindexShell(src);
assert.match(out, /<meta name="robots" content="noindex, follow" \/>/);
assert.strictEqual((out.match(/name=["']robots["']/g) || []).length, 1, 'una sola meta robots');
assert.doesNotMatch(out, /rel=["']canonical["']/, 'sin canonical');
assert.strictEqual(out.length - src.length, 'noindex, follow'.length - 'index, follow'.length, 'solo cambia la meta robots');
// La salida minificada del build (sin espacio antes de />) también se reconoce.
assert.match(makeNoindexShell('<head><meta name="robots" content="index, follow"><title>x</title></head>'), /content="noindex, follow"/);
// Salvaguardas: nunca deja las tiendas en noindex ni acepta un canonical heredado.
assert.throws(() => makeNoindexShell('<meta name="robots" content="noindex">'), /ya es noindex/);
assert.throws(() => makeNoindexShell('<title>sin robots</title>'), /hay 0/);
assert.throws(() => makeNoindexShell('<meta name="robots" content="index, follow"><link rel="canonical" href="https://vendix.online/">'), /canonical/);
assert.throws(() => makeNoindexShell('<meta name="robots" content="index, follow"><meta property="og:url" content="https://vendix.online/">'), /og:url/);
console.log('ok shell noindex (SEO-TECH-04)');
