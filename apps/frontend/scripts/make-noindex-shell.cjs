#!/usr/bin/env node
// SEO-TECH-04: genera la shell noindex que la CloudFront Function (spa-rewrite.js) sirve en las
// rutas que no deben indexarse (ayuda, PQR, auth, paneles; en tiendas: carrito, checkout, cuenta
// y enlaces con token). Es el mismo index.html del build con UNA diferencia: la meta robots dice
// "noindex, follow". Así el noindex está en la respuesta HTTP y no depende de ejecutar JavaScript.
//
// Uso: node scripts/make-noindex-shell.cjs [entrada] [salida]
//   por defecto dist/vendix/browser/index.html → dist/noindex-shell/index.html
// Sale con error (y no escribe nada) si el HTML no tiene exactamente una meta robots indexable,
// si trae canonical u og:url, o si el resultado difiere en algo más que esa meta.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROBOTS_RE = /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']\s*\/?>/gi;

function makeNoindexShell(html) {
  const robots = [...html.matchAll(ROBOTS_RE)];
  if (robots.length !== 1) throw new Error('Se esperaba una meta robots en la shell y hay ' + robots.length + '.');
  if (/noindex/i.test(robots[0][1])) throw new Error('La shell compartida ya es noindex: las tiendas dejarían de indexarse.');
  if (/<link[^>]+rel=["']canonical["']/i.test(html)) throw new Error('La shell compartida no debe declarar canonical (la reciben todas las tiendas).');
  if (/<meta[^>]+property=["']og:url["']/i.test(html)) throw new Error('La shell compartida no debe declarar og:url (la reciben todas las tiendas).');
  const out = html.replace(ROBOTS_RE, '<meta name="robots" content="noindex, follow" />');
  if (out.replace(ROBOTS_RE, '') !== html.replace(ROBOTS_RE, '')) throw new Error('La shell noindex difiere en algo más que la meta robots.');
  return out;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const input = path.resolve(root, process.argv[2] || 'dist/vendix/browser/index.html');
  const output = path.resolve(root, process.argv[3] || 'dist/noindex-shell/index.html');
  const html = makeNoindexShell(fs.readFileSync(input, 'utf8'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  console.log('Shell noindex generada: ' + path.relative(root, output));
}

module.exports = { makeNoindexShell };
