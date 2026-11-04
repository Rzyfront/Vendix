#!/usr/bin/env node
/**
 * Auditoría del registro de redirecciones (SEO-TECH-14).
 *
 * Uso: node scripts/seo/redirects-audit.cjs [docs/seo/redirects-registry.csv]
 * Código de salida 1 si hay errores.
 *
 * Detecta: destinos vacíos, destinos que son a su vez origen (cadenas A→B→C, un salto de más),
 * bucles (A→B→A, A→A), orígenes duplicados con destinos distintos y ausencia de las reglas
 * obligatorias (www→apex y /precios→/pricing).
 *
 * Reglas con comodín (origen terminado en /*) o con destino no resoluble (p. ej. "https://… (mismo host)")
 * no entran al grafo: se listan como AVISO.
 */
'use strict';

const fs = require('node:fs');

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// Primera URL absoluta del texto, normalizada (host en minúsculas, sin #).
function firstUrl(s) {
  const m = (s || '').match(/https?:\/\/[^\s,;()]+/i);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  // La barra final se conserva: /pricing/ y /pricing son URL distintas (justo lo que redirige R02).
  return { raw: m[0], key: u.protocol + '//' + u.host.toLowerCase() + u.pathname + u.search, wildcard: /\*/.test(m[0]) };
}
const hasUrl = s => /https?:\/\//i.test(s || '');

function audit(rows) {
  const errors = []; const warnings = [];
  const edges = new Map(); // origen normalizado -> { dest, id }
  const label = r => (r.id || '?');

  for (const r of rows) {
    const dest = (r.destino || '').trim();
    if (!dest || /^[—–-]+$/.test(dest)) { errors.push(label(r) + ': destino vacío'); continue; }
    if (!hasUrl(r.origen)) { errors.push(label(r) + ': origen vacío o sin URL'); continue; }
    const o = firstUrl(r.origen); const d = firstUrl(dest);
    if (!o || !d || o.wildcard || d.wildcard) { warnings.push(label(r) + ': regla con comodín o no resoluble, fuera del análisis de cadenas'); continue; }
    if ((r.origen.match(/https?:\/\//gi) || []).length > 1) { warnings.push(label(r) + ': varios orígenes en una fila, solo se analiza el primero'); }
    const prev = edges.get(o.key);
    if (prev && prev.dest !== d.key) errors.push(label(r) + ': el origen ya está en ' + prev.id + ' con otro destino (' + prev.dest + ' vs ' + d.key + ')');
    else if (!prev) edges.set(o.key, { dest: d.key, id: label(r) });
  }

  for (const [origin, { dest, id }] of edges) {
    if (origin === dest) { errors.push(id + ': bucle, el destino es igual al origen (' + origin + ')'); continue; }
    if (edges.has(dest)) {
      // seguir la cadena
      const path = [origin]; let cur = origin; let loop = false;
      while (edges.has(cur)) {
        const next = edges.get(cur).dest;
        if (path.includes(next)) { path.push(next); loop = true; break; }
        path.push(next); cur = next;
      }
      const ids = path.slice(0, -1).map(p => edges.get(p).id).join('→');
      errors.push(id + ': ' + (loop ? 'bucle ' : 'cadena ') + path.join(' → ') + ' [' + ids + ']; el destino es a su vez origen');
    }
  }

  // Reglas obligatorias: www→apex es un comodín (se busca por texto); /precios→/pricing entra al grafo.
  const has = (fromRe, destRe) => rows.some(r => fromRe.test(r.origen || '') && destRe.test((r.destino || '').trim()));
  if (!has(/^https:\/\/www\.vendix\.online\/\*/i, /^https:\/\/vendix\.online\/\*/i)) errors.push('falta la regla obligatoria www.vendix.online/* → https://vendix.online/*');
  if (!has(/^https:\/\/vendix\.online\/precios\/?$/i, /^https:\/\/vendix\.online\/pricing\/?$/i)) errors.push('falta la regla obligatoria /precios → /pricing');

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], rules: edges.size };
}

function main() {
  const file = process.argv[2] || 'docs/seo/redirects-registry.csv';
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const r = audit(rows);
  console.log('Auditoría de redirecciones · ' + file + ' · ' + rows.length + ' filas, ' + r.rules + ' en el grafo');
  r.warnings.forEach(w => console.log('AVISO  ' + w));
  r.errors.forEach(e => console.log('ERROR  ' + e));
  console.log('Resumen: ' + r.errors.length + ' error(es), ' + r.warnings.length + ' aviso(s)');
  process.exitCode = r.errors.length ? 1 : 0;
}

module.exports = { parseCsv, audit, firstUrl };
if (require.main === module) main();
