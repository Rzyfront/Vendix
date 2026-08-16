#!/usr/bin/env node
/**
 * Auditor de escrituras a base de datos.
 *
 * Coteja las claves de primer nivel del objeto `data:` de cada
 * `prisma.<modelo>.create/update/updateMany/upsert/createMany` contra los campos
 * declarados para ese modelo en `schema.prisma`.
 *
 * El compilador NO cubre esto de forma fiable: en cuanto el `data` se arma con
 * un `as any`, un spread de una variable, o el modelo se accede por una
 * propiedad dinámica, el tipo generado por Prisma deja de aplicarse y una clave
 * inventada llega hasta el motor, que responde con un
 * `PrismaClientValidationError` — un 500 «Error interno» en producción sobre lo
 * que en realidad es un nombre de columna mal escrito.
 *
 * El auditor sólo reporta lo que puede afirmar: si el literal tiene un spread,
 * una clave computada, o el modelo no se resuelve, se abstiene en vez de
 * inventar un hallazgo.
 *
 *   node scripts/audit-prisma-writes.mjs [--json]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(ROOT, 'apps/backend/prisma/schema.prisma');
const BACKEND_SRC = join(ROOT, 'apps/backend/src');

/* ------------------------------------------------------------------ *
 * 1. Modelos del schema
 * ------------------------------------------------------------------ */

/**
 * Devuelve `Map<modelo, {scalars, relations, all, required, fkOwner})`.
 *
 * - `scalars` / `relations`: una relación admite en `data` la forma anidada
 *   (`{create|connect|connectOrCreate|...}`), un escalar admite el valor
 *   directo. Ambas son claves válidas, así que para cotejar claves desconocidas
 *   basta la unión; la distinción sirve para el resto de comprobaciones.
 * - `required`: escalares que un `create` DEBE traer — sin `?`, sin
 *   `@default(...)`, sin `@updatedAt`, y no lista. Omitirlos produce un
 *   `PrismaClientValidationError`, es decir un 500.
 * - `fkOwner`: `campo_fk → [relaciones que lo declaran en @relation(fields:)]`.
 *   Un `order_id` obligatorio también queda satisfecho escribiendo
 *   `orders: { connect: ... }`, así que sin este mapa la comprobación de
 *   obligatorios produciría falsos positivos en todo el repo.
 */
function collectModels() {
  const src = readFileSync(SCHEMA, 'utf8');
  const models = new Map();
  const SCALAR_TYPES = new Set([
    'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal',
    'DateTime', 'Json', 'Bytes', 'Unsupported',
  ]);
  const re = /^model\s+([A-Za-z_][\w]*)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(src))) {
    const [, name, body] = m;
    const scalars = new Set();
    const relations = new Set();
    const required = new Set();
    const fkOwner = new Map();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = /^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(\[\])?(\?)?/.exec(line);
      if (!field) continue;
      const [, fieldName, type, list, nullable] = field;
      const hasRelation = line.includes('@relation');
      // Los enums de este schema empiezan por minúscula (`invoice_type_enum`),
      // los modelos también — así que el tipo por sí solo no distingue. Lo que
      // sí distingue es que una relación siempre lleva `@relation` o apunta a
      // un modelo declarado. Se resuelve en dos pasadas: aquí se clasifica por
      // tipo escalar conocido, y las relaciones se corrigen al final.
      const isScalar = SCALAR_TYPES.has(type) || (!hasRelation && !list);
      if (isScalar) {
        scalars.add(fieldName);
        if (!nullable && !list && !line.includes('@default(') && !line.includes('@updatedAt')) {
          required.add(fieldName);
        }
      } else {
        relations.add(fieldName);
      }
      const fields = /@relation\([^)]*fields:\s*\[([^\]]*)\]/.exec(line);
      if (fields) {
        for (const fk of fields[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!fkOwner.has(fk)) fkOwner.set(fk, []);
          fkOwner.get(fk).push(fieldName);
        }
      }
    }
    models.set(name, { scalars, relations, required, fkOwner, all: new Set([...scalars, ...relations]) });
  }

  // Segunda pasada: un campo cuyo tipo es OTRO MODELO es una relación aunque no
  // lleve `@relation` (el lado inverso no lo lleva). Sin esto, `organizations
  // organizations` se contaría como escalar obligatorio y toda creación
  // aparecería incompleta.
  const re2 = /^model\s+([A-Za-z_][\w]*)\s*\{([\s\S]*?)^\}/gm;
  while ((m = re2.exec(src))) {
    const [, name, body] = m;
    const shape = models.get(name);
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      const field = /^([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(\[\])?(\?)?/.exec(line);
      if (!field) continue;
      const [, fieldName, type] = field;
      if (models.has(type)) {
        shape.scalars.delete(fieldName);
        shape.required.delete(fieldName);
        shape.relations.add(fieldName);
      }
    }
  }
  return models;
}

/* ------------------------------------------------------------------ *
 * 2. Recorrido de archivos
 * ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.spec\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. Extracción de claves de un literal
 * ------------------------------------------------------------------ */

/**
 * Claves de primer nivel del objeto que abre en `open` (índice de su `{`).
 *
 * Devuelve `null` cuando el literal no es analizable con certeza: spread
 * (`...algo`), clave computada (`[k]:`), o llave sin cerrar. Abstenerse es
 * obligatorio — un literal con spread puede aportar cualquier clave, y
 * reportarlo produciría un hallazgo que no se puede sostener.
 */
function literalKeys(src, open) {
  if (src[open] !== '{') return null;
  const keys = [];
  let depth = 0;
  let i = open;
  let expectKey = false;
  while (i < src.length) {
    const c = src[i];
    // Cadenas y comentarios: se saltan enteros para no leer sus contenidos.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        // Una plantilla puede anidar `${ ... }` con llaves propias.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1; i += 2;
          while (i < src.length && d > 0) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') d--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) return null; i += 2; continue; }

    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (c === '{' && depth === 1) expectKey = true;
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) return keys;
      i++;
      continue;
    }
    if (depth === 1) {
      if (c === ',') { expectKey = true; i++; continue; }
      if (c === ':') { expectKey = false; i++; continue; }
      if (expectKey) {
        if (c === '.' && src.startsWith('...', i)) return null;   // spread
        if (c === '[') return null;                               // clave computada
        const id = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*[:,}]/.exec(src.slice(i));
        if (id) {
          keys.push(id[2]);
          expectKey = false;
          i += id[2].length;
          continue;
        }
      }
    }
    i++;
  }
  return null;
}

/**
 * Índice del `{` que abre el valor de `<key>:` dentro del objeto argumento de
 * la llamada que empieza en `at` (el `(`). Devuelve `null` si la clave no está,
 * o si su valor no es un literal (`data: variable` ⇒ no analizable).
 */
function findArgObject(src, at, key) {
  const needle = `${key}:`;
  let depth = 0;
  let i = at;
  let inArg = false;
  while (i < src.length && i < at + 20000) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '(' || c === '{' || c === '[') { depth++; if (depth === 2) inArg = true; i++; continue; }
    if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return null; i++; continue; }
    if (inArg && depth === 2 && src.startsWith(needle, i)) {
      let j = i + needle.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      return src[j] === '{' ? j : null;
    }
    i++;
  }
  return null;
}

const findDataObject = (src, at) => findArgObject(src, at, 'data');

/* ------------------------------------------------------------------ *
 * 4. Auditoría
 * ------------------------------------------------------------------ */

/**
 * Copia de `src` de la MISMA longitud con el contenido de comentarios y de
 * cadenas reemplazado por espacios.
 *
 * El barrido de llamadas se hace sobre esta copia y los índices se usan contra
 * el original. Sin esto, un `prisma.products.update({ data: { image_url } })`
 * escrito dentro de un `@example` de JSDoc se reporta como escritura real
 * —pasó en `s3.service.ts`—, y un hallazgo que no existe cuesta más que no
 * tener el auditor.
 */
function maskCommentsAndStrings(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      while (i < stop) { if (src[i] !== '\n') out[i] = ' '; i++; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out[i++] = ' ';
      while (i < src.length) {
        if (src[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (src[i] === quote) { out[i++] = ' '; break; }
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Campos que los clientes scopeados inyectan en `create`/`createMany`, de modo
 * que su ausencia en el literal NO significa que falten en la petición real:
 *
 * - `store_id` — `store-prisma.service.ts` y `ecommerce-prisma.service.ts`.
 * - `user_id` / `customer_id` — `ecommerce-prisma.service.ts`, según el modelo
 *   esté en `store_user_models` o en `customer_only_models`.
 *
 * `organization_id` NO está en la lista a propósito: `organization-prisma.service.ts`
 * ni siquiera scopea `create`, así que un `organization_id` obligatorio que no
 * viaje en el literal sí es un fallo real.
 *
 * La exclusión es global en vez de por cliente. Es deliberado: el auditor
 * prefiere callar de más a inventar un hallazgo.
 */
const AUTO_INJECTED = new Set(['store_id', 'user_id', 'customer_id']);

function run() {
  const models = collectModels();
  const files = walk(BACKEND_SRC);
  const unknownKeys = [];
  const missingRequired = [];
  let checked = 0;
  let orderByChecked = 0;
  let abstained = 0;

  const badOrderBy = [];
  // Lecturas: `orderBy` es un mapa estricto de campo → dirección, así que sus
  // claves de primer nivel se pueden cotejar sin ambigüedad. Es la clase que
  // dejó `return_orders` respondiendo 500 en cuatro listados a la vez, sin
  // filtro alguno, por un `orderBy: { return_date: 'desc' }` sobre una columna
  // que no existe. `where` NO se coteja: admite operadores (`AND`/`OR`/`NOT`),
  // filtros de relación y formas anidadas, y distinguir eso de un nombre mal
  // escrito daría más ruido que señal.
  const READ = /\b(?:this\.)?(?:prisma|tx|globalPrisma|client|db)\s*\.\s*([a-z_][\w]*)\s*\.\s*(findMany|findFirst|findUnique|count|aggregate|groupBy|updateMany|deleteMany)\s*\(/g;

  const CALL = /\b(?:this\.)?(?:prisma|tx|globalPrisma|client|db)\s*\.\s*([a-z_][\w]*)\s*\.\s*(create|update|updateMany|upsert|createMany)\s*\(/g;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const scan = maskCommentsAndStrings(src);
    let m;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(scan))) {
      const [, model, op] = m;
      const shape = models.get(model);
      if (!shape) continue;                      // no es un modelo real (p.ej. `.$transaction`)
      const at = m.index + m[0].length - 1;
      const open = findDataObject(src, at);
      if (open === null) { abstained++; continue; }
      const keys = literalKeys(src, open);
      if (keys === null) { abstained++; continue; }
      checked++;
      const line = src.slice(0, m.index).split('\n').length;
      const where = { file: relative(ROOT, file), line, model, op };

      const unknown = keys.filter((k) => !shape.all.has(k));
      if (unknown.length) unknownKeys.push({ ...where, unknown });

      // Obligatorios ausentes: sólo en `create`. Un `update` parcial es
      // legítimo por definición, y `upsert` no lleva `data:` (lleva
      // `create:`/`update:`), así que ya se abstuvo arriba.
      if (op === 'create') {
        const present = new Set(keys);
        const missing = [...shape.required].filter((f) => {
          if (present.has(f) || AUTO_INJECTED.has(f)) return false;
          // Una FK obligatoria también queda satisfecha por su relación:
          // `orders: { connect: { id } }` cubre `order_id`.
          const owners = shape.fkOwner.get(f) || [];
          return !owners.some((rel) => present.has(rel));
        });
        if (missing.length) missingRequired.push({ ...where, missing });
      }
    }

    READ.lastIndex = 0;
    while ((m = READ.exec(scan))) {
      const [, model, op] = m;
      const shape = models.get(model);
      if (!shape) continue;
      const at = m.index + m[0].length - 1;
      const open = findArgObject(src, at, 'orderBy');
      if (open === null) continue;              // sin orderBy literal: nada que afirmar
      const keys = literalKeys(src, open);
      if (keys === null) { abstained++; continue; }
      orderByChecked++;
      // `orderBy` admite además ordenar por una relación (`{ user: { name } }`)
      // y, en `groupBy`, por un agregado (`{ _sum: { total } }`). Ambas cuentan
      // como válidas: las relaciones ya están en `shape.all`, los agregados van
      // en esta lista.
      const AGGREGATES = new Set(['_count', '_sum', '_avg', '_min', '_max']);
      const bad = keys.filter((k) => !shape.all.has(k) && !AGGREGATES.has(k));
      if (bad.length) {
        badOrderBy.push({
          file: relative(ROOT, file),
          line: src.slice(0, m.index).split('\n').length,
          model,
          op,
          unknown: bad,
        });
      }
    }
  }

  const json = process.argv.includes('--json');
  const total = unknownKeys.length + missingRequired.length + badOrderBy.length;
  if (json) {
    console.log(JSON.stringify({ checked, orderByChecked, abstained, unknownKeys, missingRequired, badOrderBy }, null, 2));
    return total ? 1 : 0;
  }

  console.log(`modelos en schema     ${models.size}`);
  console.log(`escrituras cotejadas  ${checked}`);
  console.log(`orderBy cotejados     ${orderByChecked}`);
  console.log(`  · abstenciones      ${abstained}   (spread / clave computada / data no literal)`);
  console.log(`  · columna inexistente ${unknownKeys.length}`);
  console.log(`  · obligatorio ausente ${missingRequired.length}`);
  console.log(`  · orderBy inexistente ${badOrderBy.length}`);
  for (const f of unknownKeys) {
    console.log(`\n  [columna inexistente] ${f.file}:${f.line}`);
    console.log(`    ${f.model}.${f.op}  →  ${f.unknown.join(', ')}`);
  }
  for (const f of missingRequired) {
    console.log(`\n  [obligatorio ausente] ${f.file}:${f.line}`);
    console.log(`    ${f.model}.${f.op}  falta  ${f.missing.join(', ')}`);
  }
  for (const f of badOrderBy) {
    console.log(`\n  [orderBy inexistente] ${f.file}:${f.line}`);
    console.log(`    ${f.model}.${f.op}  orderBy  →  ${f.unknown.join(', ')}`);
  }
  return total ? 1 : 0;
}

process.exit(run());
