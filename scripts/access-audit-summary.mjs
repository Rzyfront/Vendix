#!/usr/bin/env node
/**
 * Summarizes ACCESS_AUDIT lines (apps-f4) read from stdin.
 *
 * Usage:
 *   docker logs vendix_backend 2>&1 | node scripts/access-audit-summary.mjs
 *   docker logs vendix_backend 2>&1 | node scripts/access-audit-summary.mjs --json
 *
 * Prints totals, a table counted by key x industry x decision, and counts by
 * source/surface. `--json` prints the same data as one JSON document.
 */
import { createInterface } from 'node:readline';

const MARKER = 'ACCESS_AUDIT ';
const asJson = process.argv.includes('--json');

const byTriple = new Map();
const bySurface = new Map();
let total = 0;
let invalid = 0;

const bump = (map, key, row) => {
  const current = map.get(key);
  if (current) current.count += 1;
  else map.set(key, { ...row, count: 1 });
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
// Nest colors its console output: strip ANSI escapes before parsing.
const ANSI = /\x1b\[[0-9;]*m/g;
for await (const rawLine of rl) {
  const line = rawLine.replace(ANSI, '');
  const at = line.indexOf(MARKER);
  if (at === -1) continue;
  let event;
  try {
    event = JSON.parse(line.slice(at + MARKER.length));
  } catch {
    invalid += 1;
    continue;
  }
  total += 1;
  const industry = Array.isArray(event.industry)
    ? event.industry.join(',')
    : String(event.industry ?? '');
  const key = String(event.key ?? '');
  const decision = String(event.decision ?? '');
  const source = String(event.source ?? '');
  const surface = String(event.surface ?? '');
  bump(byTriple, `${key}|${industry}|${decision}`, { key, industry, decision });
  bump(bySurface, `${source}|${surface}`, { source, surface });
}

const sortRows = (map) =>
  [...map.values()].sort(
    (a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
const triples = sortRows(byTriple);
const surfaces = sortRows(bySurface);

if (asJson) {
  console.log(
    JSON.stringify({ total, invalid, by_key_industry_decision: triples, by_source_surface: surfaces }, null, 2),
  );
} else {
  const table = (rows, cols) => {
    const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
    const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
    console.log(fmt(cols));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(fmt(cols.map((c) => r[c])));
  };
  console.log(`ACCESS_AUDIT events: ${total}${invalid ? ` (unparseable: ${invalid})` : ''}\n`);
  if (total) {
    console.log('By key x industry x decision');
    table(triples, ['key', 'industry', 'decision', 'count']);
    console.log('\nBy source / surface');
    table(surfaces, ['source', 'surface', 'count']);
  }
}
