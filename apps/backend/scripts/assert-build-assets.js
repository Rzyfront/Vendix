#!/usr/bin/env node
/**
 * Verifica que los assets declarados en nest-cli.json (compilerOptions.assets)
 * existan en dist despues de `nest build`.
 *
 * Por que existe (2026-10-14): con `watchAssets: true`, @nestjs/cli 11.0.24
 * copia los assets via un watcher chokidar asincrono que se cierra a los 500 ms;
 * si el evento no llega, no copia y no avisa (carrera silenciosa). Una imagen
 * salio sin definition-v2.schema.json y prod cayo. Este gate falla el build.
 *
 * Ejecutar desde apps/backend (usa process.cwd()).
 */
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const config = JSON.parse(
  fs.readFileSync(path.join(cwd, 'nest-cli.json'), 'utf8'),
);
const sourceRoot = config.sourceRoot || 'src';
const assets = (config.compilerOptions && config.compilerOptions.assets) || [];

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const rootAbs = path.join(cwd, sourceRoot);
const missing = [];
let total = 0;
const problems = [];

for (const asset of assets) {
  const include = typeof asset === 'string' ? asset : asset.include;
  const outDir =
    (typeof asset === 'object' && asset.outDir) || 'dist';
  if (!include) {
    problems.push('asset sin include: ' + JSON.stringify(asset));
    continue;
  }
  const normalized = include.split(path.sep).join('/');
  const starIdx = normalized.search(/[*?]/);
  const baseRel =
    starIdx === -1
      ? path.posix.dirname(normalized)
      : normalized.slice(0, normalized.lastIndexOf('/', starIdx) + 1);
  const re = globToRegExp(normalized);
  const files = walk(path.join(rootAbs, baseRel), []).filter((f) =>
    re.test(path.relative(rootAbs, f).split(path.sep).join('/')),
  );
  if (files.length === 0) {
    problems.push(
      'el include "' + include + '" no matchea ningun archivo bajo ' + sourceRoot,
    );
    continue;
  }
  for (const f of files) {
    total++;
    const rel = path.relative(rootAbs, f);
    const dest = path.join(cwd, outDir, rel);
    if (!fs.existsSync(dest)) missing.push(path.relative(cwd, dest));
  }
}

if (missing.length || problems.length) {
  console.error('assert-build-assets: FALLO');
  for (const m of missing) console.error('  falta en dist: ' + m);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('assert-build-assets: ' + total + ' assets OK');
