'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, audit } = require('./redirects-audit.cjs');

const HEAD = 'id,origen,destino\n';
const REQ = 'R01,https://www.vendix.online/*,https://vendix.online/* (misma ruta)\nR06,https://vendix.online/precios,https://vendix.online/pricing\n';
const run = body => audit(parseCsv(HEAD + REQ + body));

test('registro limpio: sin errores', () => {
  const r = run('R02,https://vendix.online/pricing/,https://vendix.online/pricing\n');
  assert.deepEqual(r.errors, []);
});

test('detecta cadena A→B→C', () => {
  const r = run('X1,https://vendix.online/a,https://vendix.online/b\nX2,https://vendix.online/b,https://vendix.online/c\n');
  assert.ok(r.errors.some(e => e.startsWith('X1') && e.includes('cadena')));
});

test('detecta bucle A→B→A', () => {
  const r = run('X1,https://vendix.online/a,https://vendix.online/b\nX2,https://vendix.online/b,https://vendix.online/a\n');
  assert.ok(r.errors.some(e => e.includes('bucle')));
});

test('detecta auto-redirección A→A', () => {
  const r = run('X1,https://vendix.online/a,https://vendix.online/a\n');
  assert.ok(r.errors.some(e => e.includes('igual al origen')));
});

test('detecta destino vacío y destino "—"', () => {
  const r = run('X1,https://vendix.online/a,\nX2,https://vendix.online/b,—\n');
  assert.equal(r.errors.filter(e => e.includes('destino vacío')).length, 2);
});

test('detecta origen duplicado con destinos distintos', () => {
  const r = run('X1,https://vendix.online/a,https://vendix.online/b\nX2,https://vendix.online/a,https://vendix.online/c\n');
  assert.ok(r.errors.some(e => e.startsWith('X2') && e.includes('otro destino')));
});

test('la barra final distingue URLs: /x/ → /x no es bucle', () => {
  assert.deepEqual(run('X1,https://vendix.online/x/,https://vendix.online/x\n').errors, []);
});

test('falta la regla www→apex o /precios→/pricing', () => {
  const r = audit(parseCsv(HEAD + 'X1,https://vendix.online/a,https://vendix.online/b\n'));
  assert.ok(r.errors.some(e => e.includes('www.vendix.online')));
  assert.ok(r.errors.some(e => e.includes('/precios')));
});

test('comodines y destinos no resolubles son aviso, no error', () => {
  const r = run('X1,http://vendix.online/* y http://www.vendix.online/*,https://… (mismo host)\n');
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.length >= 1);
});

test('parseCsv maneja comillas, comas y comillas escapadas', () => {
  const rows = parseCsv('a,b\n"x, y","di ""hola"""\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'di "hola"' }]);
});

test('el CSV del repo pasa la auditoría', () => {
  const file = path.join(__dirname, '../../docs/seo/redirects-registry.csv');
  const r = audit(parseCsv(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(r.errors, []);
});

test('CLI sale con código 1 si hay errores', () => {
  const { spawnSync } = require('node:child_process');
  const tmp = path.join(require('node:os').tmpdir(), 'redir-' + process.pid + '.csv');
  fs.writeFileSync(tmp, HEAD + 'X1,https://vendix.online/a,https://vendix.online/a\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'redirects-audit.cjs'), tmp]);
  fs.unlinkSync(tmp);
  assert.equal(r.status, 1);
});
