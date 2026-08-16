#!/usr/bin/env node
/**
 * AUDITOR DE CONTRATOS FRONTEND ↔ BACKEND
 *
 * ## Qué agujero tapa
 *
 * El monorepo tiene DOS universos de tipos que no se tocan. `tsc` valida cada
 * uno por dentro y ninguno contra el otro, así que estas dos familias de fallo
 * compilan verde y sólo revientan en runtime:
 *
 *  1. **404** — un servicio del frontend llama a una ruta que el backend no
 *     expone (se renombró el controlador, se movió el prefijo, se escribió mal
 *     el segmento).
 *  2. **400 por `forbidNonWhitelisted`** — el frontend manda una clave que el
 *     DTO no declara. `main.ts` corre el `ValidationPipe` con
 *     `forbidNonWhitelisted: true`, así que UNA clave de más tumba la petición
 *     entera con un mensaje que nombra la clave sobrante, no la que falta.
 *
 * Ambas son las que producen «internal server error por datos» y «error de dato
 * que no existe» sin que build ni tests digan nada.
 *
 * ## Cómo lee el código
 *
 * Sin AST: análisis léxico sobre el texto, con una tabla de símbolos por
 * archivo que resuelve las tres formas en que el repo compone URLs
 * (constante de clase, helper `getApiUrl(...)`, literal en el sitio de uso).
 * Es deliberadamente CONSERVADOR: lo que no puede resolver lo reporta como
 * `unresolved` en vez de inventarse una ruta, porque un falso positivo cuesta
 * una lectura y un falso negativo cuesta un 404 en producción.
 *
 * Uso:
 *   node scripts/audit-api-contracts.mjs            # resumen
 *   node scripts/audit-api-contracts.mjs --json     # salida completa
 *   node scripts/audit-api-contracts.mjs --verbose  # incluye no resueltos
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BACKEND = join(ROOT, 'apps/backend/src');
const FRONTEND = join(ROOT, 'apps/frontend/src');
const GLOBAL_PREFIX = 'api';

const ARGS = new Set(process.argv.slice(2));
const AS_JSON = ARGS.has('--json');
const VERBOSE = ARGS.has('--verbose');

// ── utilidades ──────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Normaliza una ruta a su FORMA COMPARABLE: sin barras dobles, sin barra final,
 * y con cada segmento variable colapsado a `{}`.
 *
 * `:id`, `${id}`, `${this.storeId}` y `:invoiceId` son el mismo segmento para
 * efectos de matching: lo que se compara es la FORMA de la ruta, no el nombre
 * del parámetro, que los dos lados eligen por su cuenta.
 */
function shape(path) {
  return (
    '/' +
    String(path)
      .replace(/^https?:\/\/[^/]+/, '')
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        if (seg.startsWith(':')) return '{}';
        if (seg.includes('${') || seg.includes('{')) return '{}';
        return seg;
      })
      .join('/')
  );
}

/** Quita comillas/backticks de un literal si el texto es exactamente uno. */
function unquote(text) {
  const t = text.trim();
  const m = /^(['"`])([\s\S]*)\1$/.exec(t);
  return m ? m[2] : null;
}

/**
 * Corta la lista de argumentos de una llamada respetando anidamiento.
 * Recibe el texto a partir del `(` de apertura; devuelve los argumentos de
 * primer nivel.
 */
function splitArgs(source, openParenIndex) {
  let depth = 0;
  let start = openParenIndex + 1;
  const args = [];
  let inString = null;
  let templateDepth = 0;

  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    const prev = source[i - 1];

    if (inString) {
      if (ch === inString && prev !== '\\') {
        if (inString === '`' && templateDepth > 0) {
          // seguimos dentro de la interpolación
        } else {
          inString = null;
        }
      } else if (inString === '`' && ch === '{' && prev === '$') {
        templateDepth += 1;
      } else if (inString === '`' && ch === '}' && templateDepth > 0) {
        templateDepth -= 1;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, i));
        return { args, end: i };
      }
      continue;
    }
    if (ch === ',' && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return { args, end: source.length };
}

// ── 1. inventario de rutas del backend ──────────────────────────────────────

const VERB_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

/**
 * Archivo del que un símbolo entra a `fromFile`, en forma relativa a la raíz.
 *
 * Resuelve las tres formas que usa el backend: relativa (`./dto/x`), por raíz
 * (`src/...`) y el alias `@common/...`. Devuelve `null` cuando no se puede
 * resolver, y el que llame debe entonces abstenerse de juzgar en vez de
 * arriesgarse a cotejar contra un homónimo.
 */
function resolveImport(src, symbol, fromFile) {
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;
  let m;
  for (; (m = re.exec(src)); ) {
    const named = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (!named.includes(symbol)) continue;

    const spec = m[3];
    let base;
    if (spec.startsWith('.')) {
      base = join(fromFile, '..', spec);
    } else if (spec.startsWith('src/')) {
      base = join(BACKEND, spec.slice(4));
    } else if (spec.startsWith('@common/')) {
      base = join(BACKEND, 'common', spec.slice(8));
    } else {
      return null; // paquete externo o alias que no modelamos
    }
    for (const candidate of [base + '.ts', join(base, 'index.ts')]) {
      try {
        statSync(candidate);
        return relative(ROOT, candidate);
      } catch {
        /* siguiente candidato */
      }
    }
    return null;
  }
  return null; // declarado en el mismo archivo
}

function collectBackendRoutes() {
  const routes = [];
  const files = walk(BACKEND).filter((f) => f.endsWith('.controller.ts'));

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);

    // Puede haber más de un @Controller por archivo; se recorren en orden y
    // cada método hereda el @Controller más cercano por encima suyo.
    const controllers = [];
    const ctrlRe = /@Controller\(\s*([^)]*)\)/g;
    let m;
    while ((m = ctrlRe.exec(src))) {
      const raw = m[1].trim();
      let base = '';
      if (raw) {
        const lit = unquote(raw);
        if (lit !== null) base = lit;
        else {
          // @Controller({ path: 'x' })
          const pathProp = /path\s*:\s*(['"`])([^'"`]*)\1/.exec(raw);
          base = pathProp ? pathProp[2] : '#UNRESOLVED';
        }
      }
      controllers.push({ index: m.index, base });
    }

    const verbRe = new RegExp(
      `@(${VERB_DECORATORS.join('|')})\\(\\s*([^)]*)\\)`,
      'g',
    );
    while ((m = verbRe.exec(src))) {
      const verb = m[1].toUpperCase();
      const raw = m[2].trim();
      let sub = '';
      if (raw) {
        const lit = unquote(raw);
        sub = lit !== null ? lit : '#UNRESOLVED';
      }

      let base = '';
      for (const c of controllers) {
        if (c.index < m.index) base = c.base;
        else break;
      }

      // Cuerpo del handler: desde el decorador hasta la primera `{` que abre
      // el método. Basta para leer @Body()/@Query() de la firma.
      const sigEnd = src.indexOf('{', verbRe.lastIndex);
      const signature = src.slice(verbRe.lastIndex, sigEnd < 0 ? undefined : sigEnd);

      const bodyDto = /@Body\(\s*\)\s*[a-zA-Z_$][\w$]*\s*:\s*([A-Za-z_$][\w$.]*)/.exec(
        signature,
      );
      const bodyPick = /@Body\(\s*(['"`])([^'"`]+)\1\s*\)/.exec(signature);
      const queryDto = /@Query\(\s*\)\s*[a-zA-Z_$][\w$]*\s*:\s*([A-Za-z_$][\w$.]*)/.exec(
        signature,
      );

      const full = [GLOBAL_PREFIX, base, sub].filter(Boolean).join('/');
      const line = src.slice(0, m.index).split('\n').length;

      routes.push({
        verb,
        raw: '/' + full,
        shape: shape(full),
        unresolved: full.includes('#UNRESOLVED'),
        bodyDto: bodyDto ? bodyDto[1] : null,
        // De qué archivo viene ese símbolo. Sin esto, dos DTOs homónimos en
        // dominios distintos (`CreateAdjustmentDto` de inventario y el de
        // consolidación contable) colapsan en el mismo nombre y el auditor
        // coteja contra el contrato equivocado.
        bodyDtoFrom: bodyDto ? resolveImport(src, bodyDto[1], file) : null,
        bodyPick: bodyPick ? bodyPick[2] : null,
        queryDto: queryDto ? queryDto[1] : null,
        file: rel,
        line,
      });
    }
  }
  return routes;
}

// ── 2. inventario de campos por DTO ─────────────────────────────────────────

/**
 * Campos declarados por clase, con la herencia resuelta.
 *
 * Se reconocen `extends Base`, `extends PartialType(Base)` y los helpers de
 * Swagger `PickType` / `OmitType` / `IntersectionType`, porque el
 * `ValidationPipe` los ve aplanados y el auditor tiene que verlos igual o
 * reportaría como sobrante un campo perfectamente válido.
 */
function collectDtoFields() {
  const classes = new Map();
  const homonyms = new Map();
  const files = walk(BACKEND);

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const classRe = /export\s+class\s+([A-Za-z_$][\w$]*)([^{]*)\{/g;
    let m;
    while ((m = classRe.exec(src))) {
      const name = m[1];
      const heritage = m[2];

      // Cuerpo de la clase por conteo de llaves.
      let depth = 0;
      let end = src.length;
      for (let i = m.index + m[0].length - 1; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = src.slice(m.index + m[0].length, end);

      const fields = new Set();
      // Un campo es OBLIGATORIO cuando no lleva `@IsOptional()` ni `?`. Es la
      // misma lectura que hace `ValidationPipe`, y es lo que decide si omitirlo
      // desde el frontend produce un 400.
      const optional = new Set();
      const fieldRe =
        /^[ \t]{2}(?:(?:public|private|protected|readonly|static|declare)\s+)*([a-zA-Z_$][\w$]*)(\s*[?!]?)\s*(?::|=)/gm;
      let f;
      while ((f = fieldRe.exec(body))) {
        const prop = f[1];
        // Descartar métodos: `nombre(` en vez de `nombre:`
        const after = body.slice(f.index + f[0].length - 1);
        if (/^\s*\(/.test(after)) continue;
        if (['constructor', 'if', 'for', 'while', 'return'].includes(prop)) {
          continue;
        }
        fields.add(prop);

        // Decoradores del campo: se leen hacia atrás hasta el campo anterior.
        const prevEnd = body.lastIndexOf(';', f.index);
        const decorators = body.slice(prevEnd + 1, f.index);
        const isOptional =
          f[2].includes('?') ||
          /@IsOptional\s*\(/.test(decorators) ||
          /@ValidateIf\s*\(/.test(decorators);
        if (isOptional) optional.add(prop);
      }

      const parents = [];
      let parentsAllOptional = false;
      const ext = /extends\s+([A-Za-z_$][\w$]*)\s*(\(([^)]*)\))?/.exec(heritage);
      if (ext) {
        const helper = ext[1];
        if (
          ['PartialType', 'PickType', 'OmitType', 'IntersectionType'].includes(
            helper,
          )
        ) {
          const inner = ext[3] ?? '';
          for (const ref of inner.match(/[A-Za-z_$][\w$]*/g) ?? []) {
            if (/^[A-Z]/.test(ref)) parents.push(ref);
          }
          // `PartialType` vuelve opcional TODO lo heredado; tratarlo como
          // obligatorio marcaría de falta campos que el backend acepta omitir.
          if (helper === 'PartialType') parentsAllOptional = true;
        } else {
          parents.push(helper);
        }
      }

      const entry = {
        name,
        fields,
        optional,
        parents,
        parentsAllOptional,
        file: rel,
      };
      classes.set(name, entry);
      // Índice secundario `archivo#Clase`: la única llave que distingue dos
      // DTOs homónimos de dominios distintos.
      classes.set(`${rel}#${name}`, entry);
      if (!homonyms.has(name)) homonyms.set(name, []);
      homonyms.get(name).push(entry);
    }
  }

  // Aplanado de la herencia (con corte por ciclos).
  const flat = new Map();
  const flatOptional = new Map();
  const resolve = (name, seen = new Set()) => {
    if (flat.has(name)) return flat.get(name);
    const entry = classes.get(name);
    if (!entry || seen.has(name)) return new Set();
    seen.add(name);
    const all = new Set(entry.fields);
    const opt = new Set(entry.optional);
    for (const parent of entry.parents) {
      const inherited = resolve(parent, seen);
      const inheritedOpt = flatOptional.get(parent) ?? new Set();
      for (const field of inherited) {
        all.add(field);
        if (entry.parentsAllOptional || inheritedOpt.has(field)) opt.add(field);
      }
    }
    flat.set(name, all);
    flatOptional.set(name, opt);
    return all;
  };
  for (const name of classes.keys()) resolve(name);
  return { classes, flat, flatOptional, homonyms };
}

// ── 2b. claves de un objeto literal ─────────────────────────────────────────

/**
 * Claves de PRIMER nivel del objeto literal que abre en `open`.
 *
 * Sólo interesa el primer nivel: `forbidNonWhitelisted` rechaza en la raíz del
 * DTO, y los objetos anidados los valida `@ValidateNested` contra su propio
 * DTO, que este auditor cruza por separado cuando la ruta lo declara.
 */
function literalKeys(src, open) {
  if (src[open] !== '{') return null;
  const keys = new Set();
  let hasSpread = false;
  let hasComputed = false;
  let depth = 0;
  let i = open;
  // Sin este estado, `{ refresh_token: refreshToken }` reporta DOS claves: la
  // real y el identificador que está en posición de VALOR. Una clave sobrante
  // inventada frena un merge por nada, así que el estado no es opcional.
  let expectKey = false;

  for (; i < src.length; i += 1) {
    const ch = src[i];

    if (ch === '{' || ch === '[' || ch === '(') {
      // `{ [algo]: v }` — clave calculada: no se puede enumerar.
      if (ch === '[' && depth === 1 && expectKey) hasComputed = true;
      depth += 1;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      if (depth === 1 && expectKey) {
        const literal = src.slice(start + 1, i);
        const after = /^\s*:/.test(src.slice(i + 1));
        if (after) keys.add(literal);
        expectKey = false;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    if (depth !== 1) continue;

    if (ch === ',') {
      expectKey = true;
      continue;
    }
    if (ch === ':') {
      expectKey = false;
      continue;
    }
    if (/\s/.test(ch)) continue;

    if (!expectKey) continue;

    if (src.startsWith('...', i)) {
      hasSpread = true;
      i += 2;
      expectKey = false;
      continue;
    }
    const prop = /^([A-Za-z_$][\w$]*)\s*(:|,|\}|\()/.exec(src.slice(i));
    if (prop) {
      // `{ foo }` (shorthand) y `{ foo: bar }` declaran la misma clave.
      keys.add(prop[1]);
      i += prop[1].length - 1;
      expectKey = false;
      continue;
    }
    // Algo que no es una clave enumerable (clave calculada ya la atrapó el
    // `[` de arriba, o sintaxis que no modelamos): no adivinar.
    expectKey = false;
  }

  return { keys, hasSpread, hasComputed, end: i };
}

/**
 * `const payload = { ... }` / `const payload: T = { ... }` por archivo, con la
 * posición de la declaración para poder atribuir sólo las asignaciones
 * `payload.x = ...` que ocurren ANTES de la llamada HTTP.
 */
function objectLiteralTable(src) {
  const table = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const parsed = literalKeys(src, open);
    if (!parsed) continue;
    if (!table.has(m[1])) table.set(m[1], []);
    table.get(m[1]).push({ at: m.index, ...parsed });
  }
  return table;
}

// ── 2c. inventario de tipos del frontend ────────────────────────────────────

/**
 * `interface X { ... }` y `type X = { ... }` de todo el frontend.
 *
 * Es la otra mitad del contrato: cuando un servicio recibe `dto: CreateXDto`
 * y lo reenvía tal cual, lo que viaja son los campos de ESTA interfaz, no los
 * del DTO del backend. Cuando las dos divergen, el `ValidationPipe` contesta
 * 400 y ningún compilador lo había visto, porque son dos declaraciones
 * distintas que nadie obliga a coincidir.
 */
function collectFrontendTypes() {
  const types = new Map();
  const files = walk(FRONTEND);

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const re =
      /export\s+(?:interface\s+([A-Za-z_$][\w$]*)([^{]*)|type\s+([A-Za-z_$][\w$]*)\s*=\s*)\{/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1] ?? m[3];
      const heritage = m[2] ?? '';
      const open = src.indexOf('{', m.index + m[0].length - 1);

      let depth = 0;
      let end = src.length;
      for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = src.slice(open + 1, end);

      const fields = new Set();
      const optional = new Set();
      const fieldRe =
        /^\s*(?:readonly\s+)?(?:(['"])([\w$]+)\1|([A-Za-z_$][\w$]*))(\??)\s*:/gm;
      let f;
      while ((f = fieldRe.exec(body))) {
        // Sólo el primer nivel: los anidados se cruzan por su propio DTO.
        const before = body.slice(0, f.index);
        let d = 0;
        for (const ch of before) {
          if (ch === '{' || ch === '[' || ch === '(') d += 1;
          else if (ch === '}' || ch === ']' || ch === ')') d -= 1;
        }
        if (d !== 0) continue;
        const prop = f[2] ?? f[3];
        fields.add(prop);
        if (f[4] === '?') optional.add(prop);
      }
      // Índice de firma `[k: string]: unknown` — acepta cualquier clave.
      const openIndex = /^\s*\[[^\]]+\]\s*:/m.test(body);

      const parents = [];
      for (const ref of (heritage.match(/[A-Za-z_$][\w$]*/g) ?? []).slice(1)) {
        if (/^[A-Z]/.test(ref)) parents.push(ref);
      }

      types.set(name, { name, fields, optional, parents, openIndex, file: rel });
    }
  }

  const flat = new Map();
  const flatOptional = new Map();
  const resolve = (name, seen = new Set()) => {
    if (flat.has(name)) return flat.get(name);
    const entry = types.get(name);
    if (!entry || seen.has(name)) return new Set();
    seen.add(name);
    const all = new Set(entry.fields);
    const opt = new Set(entry.optional);
    for (const parent of entry.parents) {
      for (const field of resolve(parent, seen)) all.add(field);
      for (const field of flatOptional.get(parent) ?? []) opt.add(field);
      if (types.get(parent)?.openIndex) entry.openIndex = true;
    }
    flat.set(name, all);
    flatOptional.set(name, opt);
    return all;
  };
  for (const name of types.keys()) resolve(name);
  return { types, flat, flatOptional };
}

// ── 3. inventario de llamadas del frontend ──────────────────────────────────

/**
 * Tabla de símbolos de UN archivo: constantes de texto y helpers de una línea
 * que devuelven una plantilla. Es lo mínimo que hace falta para resolver las
 * tres formas de componer URL que usa el repo.
 */
function symbolTable(src) {
  const strings = new Map();
  const helpers = new Map();

  const assignRe =
    /(?:^|\n)\s*(?:private|public|protected|readonly|const|let|static)?\s*(?:readonly\s+)?([a-zA-Z_$][\w$]*)\s*(?::\s*string)?\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let m;
  // POSICIONAL, no «último gana»: `const url = ...` se repite en casi todos los
  // métodos de un servicio con valores distintos. Quedarse con la última
  // asignación del archivo hacía que una llamada resolviera con la URL de OTRO
  // método —y el auditor reportaba 404 sobre código correcto.
  while ((m = assignRe.exec(src))) {
    if (!strings.has(m[1])) strings.set(m[1], []);
    strings.get(m[1]).push({ index: m.index, value: m[2].slice(1, -1) });
  }

  // `private readonly api = environment.apiUrl;` — sin comillas, así que la
  // regla de arriba no lo ve. Sin esto la base se colapsaba a `{}` y CADA
  // llamada del servicio quedaba «sin resolver», escondiendo los 404 reales
  // detrás de ruido.
  const envRe =
    /(?:^|\n)\s*(?:private|public|protected|readonly|const|let|static)?\s*(?:readonly\s+)?([a-zA-Z_$][\w$]*)\s*(?::\s*string)?\s*=\s*environment\.apiUrl\s*;/g;
  while ((m = envRe.exec(src))) {
    if (!strings.has(m[1])) strings.set(m[1], []);
    strings.get(m[1]).push({ index: m.index, value: 'API' });
  }

  // Helpers de URL. Se acepta cuerpo con sentencias previas al `return`
  // (`const suffix = endpoint ? ... ;`), porque esa es la forma dominante y
  // exigir una sola expresión dejaba fuera servicios enteros.
  const headRe =
    /(?:^|\n)[ \t]*(?:private|public|protected)?\s*(?:readonly\s+)?([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*string\s*)?\{/g;
  while ((m = headRe.exec(src))) {
    const name = m[1];
    if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) {
      continue;
    }
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const body = src.slice(openIdx + 1, end);
    // Sólo cuerpos cortos: un helper de URL no tiene lógica. El límite es
    // generoso a propósito — en este repo los helpers llevan tres o cuatro
    // líneas de comentario explicando por qué enrutan como enrutan, y con un
    // corte estrecho quedaban fuera servicios enteros.
    if (body.length > 1200) continue;

    // El `return` de un helper de URL es de una de dos formas: una plantilla
    // suelta, o una TERNARIA entre dos plantillas (`scope === 'organization'
    // ? '<org>' : '<store>'`). La segunda es la que enruta por ámbito y es muy
    // común; ignorarla dejaba servicios enteros sin resolver, y una llamada
    // «no resuelta» no es una llamada verificada.
    const retStart = /return\s/.exec(body);
    if (!retStart) continue;
    const retBody = body.slice(retStart.index);
    const templates = (retBody.match(/`[^`]*`|'[^']*'|"[^"]*"/g) ?? [])
      .map((t) => t.slice(1, -1))
      // La condición del ternario también es una cadena (`userScope() ===
      // 'organization'`) y aparece ANTES que las ramas. Tomarla como candidata
      // dejaba el helper resolviendo a la palabra del enum en vez de a la URL.
      .filter((t) => t.includes('/') || t.includes('${'));
    if (!templates.length) continue;

    // Se guarda también el VALOR POR DEFECTO (`endpoint = ''`): sin él, una
    // llamada sin argumentos —`this.getApiUrl()`, la forma con la que casi todo
    // servicio pide su ruta raíz— se resolvía a `{}` y el auditor la reportaba
    // como 404 sobre un endpoint que existe.
    const params = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const name = p.split(/[:=?]/)[0].trim();
        const def = /=\s*(`[^`]*`|'[^']*'|"[^"]*")\s*$/.exec(p);
        return { name, default: def ? def[1].slice(1, -1) : '' };
      });

    // Locales del propio helper (`const suffix = ...`), para poder sustituirlas
    // en la plantilla del return.
    const locals = new Map();
    const localRe =
      /const\s+([a-zA-Z_$][\w$]*)\s*=\s*([^;]+);/g;
    let l;
    while ((l = localRe.exec(body))) locals.set(l[1], l[2].trim());

    helpers.set(name, { params, templates, locals });
  }

  return { strings, helpers };
}

/**
 * Valor de una constante de texto EN EL PUNTO del archivo donde se usa.
 *
 * Se elige la asignación más cercana por encima; si no hay ninguna por encima
 * —campo de clase declarado debajo de los métodos, que igual se inicializa
 * antes— se usa la primera.
 */
function lookupString(table, name, at) {
  const entries = table.strings.get(name);
  if (!entries || entries.length === 0) return null;
  let best = null;
  for (const entry of entries) {
    if (entry.index < at) best = entry;
  }
  return (best ?? entries[0]).value;
}

/** Resuelve una expresión de URL a su forma comparable, o `null`. */
function resolveUrl(expr, table, at, depth = 0) {
  if (depth > 4) return null;
  const text = expr.trim();

  const lit = unquote(text);
  if (lit !== null) return expandTemplate(lit, table, at, depth);

  // `this.baseUrl` / `BASE_URL`
  const ident = /^(?:this\.)?([a-zA-Z_$][\w$]*)$/.exec(text);
  const identValue = ident ? lookupString(table, ident[1], at) : null;
  if (identValue) {
    return expandTemplate(identValue, table, at, depth + 1);
  }

  // `this.getApiUrl('x')` — se sustituye el parámetro por el argumento.
  //
  // No basta con `${param}` a secas: la forma dominante en el repo es
  // `${endpoint ? '/' + endpoint : ''}`, un ternario que concatena la barra
  // sólo cuando hay sufijo. Se sustituye CUALQUIER interpolación que mencione
  // el parámetro, y se le antepone la barra si la expresión la concatenaba —
  // si no, la ruta salía truncada en la base y el auditor reportaba 404 sobre
  // servicios perfectamente sanos.
  const call = /^(?:this\.)?([a-zA-Z_$][\w$]*)\s*\(/.exec(text);
  if (call && table.helpers.has(call[1])) {
    const helper = table.helpers.get(call[1]);
    const { args } = splitArgs(text, text.indexOf('('));

    const candidates = helper.templates
      .map((template) =>
        substituteHelper(template, helper, args, table, at, depth),
      )
      .filter(Boolean);
    // Con varias ramas se prefiere la que el backend SÍ expone. Si ninguna
    // existe se devuelve la primera, para que el 404 se reporte en vez de
    // esconderse: el auditor puede elegir entre ramas, no callar un fallo.
    return candidates.find(existsInBackend) ?? candidates[0] ?? null;
  }

  return null;
}

/** Forma de ruta de una URL ya resuelta, o `null` si no apunta a nuestra API. */
function apiShape(resolved) {
  if (!resolved || !resolved.includes('API')) return null;
  return shape(GLOBAL_PREFIX + '/' + resolved.split('API')[1]);
}

/**
 * Inventario de formas del backend, para que el resolutor pueda elegir entre
 * las ramas de un helper con `return A ? ... : ...`. Lo rellena `run()` antes
 * de recorrer el frontend.
 */
let BACKEND_SHAPES = new Set();
const existsInBackend = (resolved) => {
  const s = apiShape(resolved);
  return s !== null && BACKEND_SHAPES.has(s);
};

/** Sustituye los parámetros de un helper en UNA de sus plantillas de return. */
function substituteHelper(template, helper, args, table, at, depth) {
  let out = template;

  out = out.replace(/\$\{([^}]*)\}/g, (whole, inner) => {
    // Una local del helper (`const suffix = endpoint ? '/'+endpoint : ''`)
    // se sustituye por su expresión antes de buscar el parámetro.
    let expr = inner;
    for (const [localName, localExpr] of helper.locals ?? []) {
      expr = expr.replace(new RegExp(`\\b${localName}\\b`, 'g'), localExpr);
    }

    const idx = helper.params.findIndex((p) =>
      new RegExp(`\\b${p.name}\\b`).test(expr),
    );
    if (idx < 0) return whole; // no habla de un parámetro: lo ve expandTemplate
    const rawArg = args[idx];
    const omitted = rawArg === undefined || rawArg.trim() === '';
    const literal = omitted ? helper.params[idx].default : unquote(rawArg);
    // Argumento no literal (una variable, un enum): la FORMA del segmento es
    // desconocida, y adivinarla produciría un 404 falso.
    const value = literal !== null ? literal : '{}';
    if (!value) return '';
    const concatenatesSlash = /['"`]\//.test(expr);
    return concatenatesSlash && !value.startsWith('/') ? '/' + value : value;
  });

  return expandTemplate(out, table, at, depth + 1);
}

/** Sustituye `${x}` por su constante si se conoce, o por `{}` si no. */
function expandTemplate(text, table, at, depth) {
  let out = text;
  const interp = /\$\{([^}]*)\}/g;
  let m;
  const replacements = [];
  while ((m = interp.exec(text))) {
    const inner = m[1].trim();
    const id = /^(?:this\.)?([a-zA-Z_$][\w$]*)$/.exec(inner);
    // Un campo inicializado a cadena VACÍA (`token = ''`) no es una constante:
    // es estado que se rellena en runtime. Sustituirlo borraba el segmento y la
    // ruta salía un nivel más corta de lo que realmente se pide.
    const idValue = id ? lookupString(table, id[1], at) : null;

    // `${this.baseUrl()}/x` -- una LLAMADA a helper dentro de la plantilla.
    // Es la forma dominante en los servicios que enrutan por ambito, y sin
    // resolverla la base colapsaba a `{}`: cientos de llamadas quedaban sin
    // resolver, que es indistinguible de no haberlas revisado.
    const isCall = /^(?:this\.)?[a-zA-Z_$][\w$]*\s*\(/.test(inner);
    const callValue =
      !idValue && isCall && depth < 4
        ? resolveUrl(inner, table, at, depth + 1)
        : null;
    if (idValue && depth < 4) {
      replacements.push([m[0], idValue]);
    } else if (callValue) {
      replacements.push([m[0], callValue]);
    } else if (/environment\.apiUrl/.test(inner)) {
      replacements.push([m[0], 'API']);
    } else {
      replacements.push([m[0], '{}']);
    }
  }
  for (const [from, to] of replacements) out = out.replace(from, to);
  if (/\$\{/.test(out) && depth < 4)
    return expandTemplate(out, table, at, depth + 1);
  return out;
}

/**
 * ¿Sigue vivo en `to` lo que se declaró en `from`?
 *
 * Si entre ambos puntos se cierra una llave más de las que se abren, la
 * declaración pertenecía a otro método y el nombre en `to` es otra cosa —
 * casi siempre un parámetro que la sombrea. Sin esta comprobación el auditor
 * atribuye a una llamada el cuerpo de un método vecino.
 */
function sameScope(src, from, to) {
  let balance = 0;
  for (let i = from; i < to; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < to && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0 || nl >= to) return balance >= 0;
      i = nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i);
      if (close < 0 || close >= to) return balance >= 0;
      i = close + 1;
      continue;
    }
    if (ch === '{') balance += 1;
    else if (ch === '}') {
      balance -= 1;
      if (balance < 0) return false;
    }
  }
  return true;
}

/**
 * Tipo anotado de `name` en el punto `at`: parámetro de método
 * (`create(dto: CreateXDto)`) o variable (`const dto: CreateXDto = ...`).
 *
 * Se toma la anotación más cercana por encima que siga en ámbito. `Partial<T>`
 * y `Readonly<T>` se desenvuelven porque no cambian el juego de claves.
 */
function resolveDeclaredType(src, name, at) {
  const re = new RegExp(
    `\\b${name}\\s*\\??\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*(<\\s*([A-Za-z_$][\\w$]*)\\s*>)?`,
    'g',
  );
  let best = null;
  let m;
  while ((m = re.exec(src))) {
    if (m.index >= at) break;
    best = m;
  }
  if (!best) return null;

  // La anotación tiene que estar VIVA aquí. Ojo con el matiz: la de un
  // parámetro vive en la firma, o sea FUERA de las llaves del cuerpo, así que
  // medir el ámbito desde ella da 0 al cerrar el método y haría pasar por
  // buena la anotación de un método vecino. Para un parámetro el ámbito es el
  // bloque que abre justo después.
  const tail = src.slice(best.index, best.index + 4000);
  const brace = tail.indexOf('{');
  const assign = tail.search(/[=;]/);
  const isParam = brace >= 0 && (assign < 0 || brace < assign);
  const scopeFrom = isParam ? best.index + brace + 1 : best.index;
  if (!sameScope(src, scopeFrom, at)) return null;
  const outer = best[1];
  const inner = best[3];
  if (['Partial', 'Readonly', 'Required', 'Omit', 'Pick'].includes(outer)) {
    if (!inner) return null;
    // `Partial<X>` deja que el llamador mande CUALQUIER subconjunto: ningún
    // campo viaja con seguridad, así que nada de esto puede afirmarse como
    // 400 garantizado. Se marca para degradarlo a aviso.
    return { name: inner, allOptional: outer === 'Partial' };
  }
  return { name: outer, allOptional: false };
}

/**
 * Claves que el frontend va a serializar en el cuerpo de la petición.
 *
 * Devuelve `null` cuando el cuerpo no se puede leer estáticamente (un DTO que
 * llega por parámetro, un `FormData`, una expresión). Preferimos no saber a
 * inventar: un falso positivo aquí frena un merge por nada.
 */
function resolveBodyKeys(src, expr, literals, at) {
  if (!expr) return null;
  const trimmed = expr.trim();

  if (trimmed.startsWith('{')) {
    const open = src.indexOf('{', src.indexOf(trimmed[0], at));
    // Reparsear desde la posición real evita depender del recorte de `expr`.
    const idx = src.indexOf(trimmed.slice(0, 40), at);
    const parsed = literalKeys(src, idx >= 0 ? src.indexOf('{', idx) : open);
    return parsed ? { ...parsed, source: 'literal' } : null;
  }

  const ident = /^([A-Za-z_$][\w$]*)$/.exec(trimmed);
  if (!ident) return null;

  const name = ident[1];
  const decls = literals.get(name);
  if (!decls || !decls.length) {
    // Sin literal en ámbito: quizá sea un parámetro tipado que se reenvía tal
    // cual. En ese caso el contrato lo fija su interfaz, no un objeto local.
    const declaredType = resolveDeclaredType(src, name, at);
    return declaredType
      ? {
          typeName: declaredType.name,
          allOptional: declaredType.allOptional,
          source: 'type',
        }
      : null;
  }

  // La declaración más cercana POR ENCIMA de la llamada Y en su mismo ámbito.
  const decl = [...decls]
    .reverse()
    .find((d) => d.at < at && sameScope(src, d.at, at));
  if (!decl) return null;
  const keys = new Set(decl.keys);

  // `payload.x = ...` y `payload['x'] = ...` entre la declaración y la llamada.
  const window = src.slice(decl.at, at);
  const assignRe = new RegExp(
    `\\b${name}\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*(['"])([^'"]+)\\2\\s*\\])\\s*=[^=]`,
    'g',
  );
  let a;
  let dynamicKey = false;
  while ((a = assignRe.exec(window))) keys.add(a[1] ?? a[3]);
  // `payload[algo] = ...` con clave calculada: no se puede enumerar.
  if (new RegExp(`\\b${name}\\s*\\[\\s*[A-Za-z_$]`).test(window)) {
    dynamicKey = true;
  }
  // Un `Object.assign(payload, ...)` también añade claves invisibles.
  if (new RegExp(`Object\\.assign\\s*\\(\\s*${name}\\b`).test(window)) {
    dynamicKey = true;
  }

  return {
    keys,
    hasSpread: decl.hasSpread,
    hasComputed: decl.hasComputed || dynamicKey,
    source: 'variable',
  };
}

function collectFrontendCalls() {
  const calls = [];
  const files = walk(FRONTEND);

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('http.')) continue;
    const rel = relative(ROOT, file);
    const table = symbolTable(src);
    const literals = objectLiteralTable(src);

    const callRe = /\.http\s*\.\s*(get|post|put|patch|delete)\s*(<[^(]*>)?\s*\(/g;
    let m;
    while ((m = callRe.exec(src))) {
      const open = src.indexOf('(', m.index + m[0].length - 1);
      const { args } = splitArgs(src, open);
      const line = src.slice(0, m.index).split('\n').length;
      const resolved =
        args[0] !== undefined ? resolveUrl(args[0], table, m.index) : null;

      const bodyExpr = ['post', 'put', 'patch'].includes(m[1])
        ? (args[1] ?? '').trim()
        : null;

      calls.push({
        verb: m[1].toUpperCase(),
        expr: (args[0] ?? '').trim().replace(/\s+/g, ' ').slice(0, 160),
        resolved,
        body: bodyExpr,
        bodyKeys: resolveBodyKeys(src, bodyExpr, literals, m.index),
        file: rel,
        line,
      });
    }
  }
  return calls;
}

// ── 4. cruce ────────────────────────────────────────────────────────────────

function run() {
  const routes = collectBackendRoutes();
  const { flat, flatOptional, homonyms } = collectDtoFields();

  /**
   * Llave con la que consultar el DTO de un handler.
   *
   * Cuando el nombre es único basta el nombre. Cuando hay homónimos hace falta
   * el archivo del `import`; si tampoco lo tenemos, devuelve `null` y el
   * cotejo se salta esa ruta antes que arriesgar un veredicto contra el DTO de
   * otro dominio.
   */
  const dtoKey = (route) => {
    if (!route.bodyDto) return null;
    const variants = homonyms.get(route.bodyDto) ?? [];
    if (variants.length <= 1) {
      return flat.has(route.bodyDto) ? route.bodyDto : null;
    }
    if (!route.bodyDtoFrom) return null;
    const key = `${route.bodyDtoFrom}#${route.bodyDto}`;
    return flat.has(key) ? key : null;
  };
  const {
    types: feTypes,
    flat: feFlat,
    flatOptional: feFlatOptional,
  } = collectFrontendTypes();
  // Debe poblarse ANTES de recorrer el frontend: el resolutor lo consulta para
  // elegir entre las ramas de un helper que enruta por ámbito.
  BACKEND_SHAPES = new Set(routes.map((r) => r.shape));
  const calls = collectFrontendCalls();

  const byShape = new Map();
  for (const r of routes) {
    const key = r.verb + ' ' + r.shape;
    if (!byShape.has(key)) byShape.set(key, []);
    byShape.get(key).push(r);
  }
  const shapesOnly = new Set(routes.map((r) => r.shape));

  const missing = [];
  const wrongVerb = [];
  const unresolved = [];
  const extraKeys = [];
  const missingRequired = [];
  const widerType = [];
  const bodyChecked = [];

  /**
   * Cruza las claves del cuerpo contra el DTO que declara el handler.
   *
   * Una clave sobrante es un 400 DETERMINISTA: `main.ts` arranca el
   * `ValidationPipe` con `forbidNonWhitelisted: true`, así que basta un campo
   * de más para que la petición no llegue nunca al servicio.
   */
  const checkBody = (call, path) => {
    if (!call.bodyKeys) return;
    const handlers = byShape.get(call.verb + ' ' + path) ?? [];
    const withDto = handlers.filter((r) => dtoKey(r));
    if (withDto.length !== 1) return; // ambiguo o sin DTO tipado: no se juzga
    const route = withDto[0];
    const key = dtoKey(route);
    const declared = flat.get(key);
    const optional = flatOptional.get(key) ?? new Set();

    // Dos orígenes de claves: un objeto literal que se ve entero, o la
    // interfaz del frontend que tipa lo que el servicio reenvía.
    let keys;
    let alwaysSent;
    let via;
    if (call.bodyKeys.source === 'type') {
      const t = feTypes.get(call.bodyKeys.typeName);
      if (!t || t.openIndex) return; // índice de firma: cualquier clave vale
      keys = feFlat.get(call.bodyKeys.typeName);
      if (!keys || !keys.size) return;
      // Matiz que decide la severidad: una interfaz declara el universo
      // POSIBLE, no lo que viaja. Un campo opcional que nadie rellena no
      // produce 400 nunca; uno OBLIGATORIO viaja siempre y sí lo produce.
      const feOpt = feFlatOptional.get(call.bodyKeys.typeName) ?? new Set();
      alwaysSent = call.bodyKeys.allOptional
        ? new Set()
        : new Set([...keys].filter((k) => !feOpt.has(k)));
      via = `${call.bodyKeys.typeName} (${t.file})`;
    } else {
      if (!call.bodyKeys.keys.size) return;
      keys = call.bodyKeys.keys;
      alwaysSent = keys; // un literal se serializa entero
      via = 'literal';
    }

    bodyChecked.push(call);

    const extra = [...alwaysSent].filter((k) => !declared.has(k));
    if (extra.length) {
      extraKeys.push({ ...call, path, dto: route.bodyDto, extra, route, via });
    }
    const extraOpt = [...keys].filter(
      (k) => !declared.has(k) && !alwaysSent.has(k),
    );
    if (extraOpt.length) {
      widerType.push({
        ...call,
        path,
        dto: route.bodyDto,
        extra: extraOpt,
        route,
        via,
      });
    }

    const required = [...declared].filter((k) => !optional.has(k));
    let absent;
    if (call.bodyKeys.source === 'type') {
      // Un obligatorio del backend que la interfaz del frontend ni siquiera
      // declara es imposible de enviar desde este servicio.
      absent = required.filter((k) => !keys.has(k));
    } else {
      // Con spread o claves calculadas no sabemos qué más viaja: no se juzga.
      if (call.bodyKeys.hasSpread || call.bodyKeys.hasComputed) return;
      absent = required.filter((k) => !keys.has(k));
    }
    if (absent.length) {
      missingRequired.push({
        ...call,
        path,
        dto: route.bodyDto,
        absent,
        route,
        via,
      });
    }
  };

  for (const call of calls) {
    if (!call.resolved) {
      unresolved.push(call);
      continue;
    }
    // Sólo interesan las URL que apuntan a NUESTRA API.
    if (!call.resolved.includes('API')) {
      unresolved.push({ ...call, reason: 'no-api-base' });
      continue;
    }
    const path = shape(
      GLOBAL_PREFIX + '/' + call.resolved.split('API')[1],
    );
    // Un `{}` pegado a la base significa que el ÁREA quedó sin resolver
    // (`this.scopeToBasePath(scope)`), no que la ruta no exista. Reportarlo
    // como 404 sería un falso positivo garantizado.
    if (/^\/api\/\{\}/.test(path)) {
      unresolved.push({ ...call, reason: 'area-dinamica' });
      continue;
    }
    const key = call.verb + ' ' + path;
    if (byShape.has(key)) {
      checkBody(call, path);
      continue;
    }
    if (shapesOnly.has(path)) {
      wrongVerb.push({ ...call, path });
    } else {
      missing.push({ ...call, path });
    }
  }

  const report = {
    counts: {
      backendRoutes: routes.length,
      backendUnresolved: routes.filter((r) => r.unresolved).length,
      dtoClasses: homonyms.size,
      frontendCalls: calls.length,
      matched:
        calls.length - missing.length - wrongVerb.length - unresolved.length,
      missing: missing.length,
      wrongVerb: wrongVerb.length,
      unresolved: unresolved.length,
      bodyChecked: bodyChecked.length,
      extraKeys: extraKeys.length,
      missingRequired: missingRequired.length,
      widerType: widerType.length,
    },
    missing,
    wrongVerb,
    extraKeys,
    missingRequired,
    widerType,
    unresolved: VERBOSE ? unresolved : unresolved.slice(0, 20),
  };

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2));
    return;
  }

  const c = report.counts;
  console.log('── Auditoría de contratos FE ↔ BE ──────────────────────────');
  console.log(`rutas backend        ${c.backendRoutes}`);
  console.log(`clases DTO           ${c.dtoClasses}`);
  console.log(`llamadas frontend    ${c.frontendCalls}`);
  console.log(`  · con ruta válida  ${c.matched}`);
  console.log(`  · SIN ruta (404)   ${c.missing}`);
  console.log(`  · verbo distinto   ${c.wrongVerb}`);
  console.log(`  · no resueltas     ${c.unresolved}`);
  console.log(`cuerpos cotejados    ${c.bodyChecked}`);
  console.log(`  · campo sobrante   ${c.extraKeys}   (400 seguro)`);
  console.log(`  · falta obligatorio ${c.missingRequired}  (aviso)`);
  console.log(`  · interfaz más ancha ${c.widerType} (aviso)`);
  console.log('');

  if (missing.length) {
    console.log('▸ Llamadas a rutas que el backend NO expone:');
    for (const x of missing) {
      console.log(`   ${x.verb} ${x.path}\n     ${x.file}:${x.line}`);
    }
    console.log('');
  }
  if (wrongVerb.length) {
    console.log('▸ La ruta existe pero con otro verbo:');
    for (const x of wrongVerb) {
      const others = routes
        .filter((r) => r.shape === x.path)
        .map((r) => r.verb)
        .join('/');
      console.log(
        `   ${x.verb} ${x.path} (backend expone ${others})\n     ${x.file}:${x.line}`,
      );
    }
    console.log('');
  }

  if (extraKeys.length) {
    console.log(
      '▸ Campos que el DTO NO declara (forbidNonWhitelisted ⇒ 400):',
    );
    for (const x of extraKeys) {
      console.log(
        `   ${x.verb} ${x.path}  →  ${x.dto}\n     vía:   ${x.via}\n     sobra: ${x.extra.join(', ')}\n     ${x.file}:${x.line}\n     dto:   ${x.route.file}:${x.route.line}`,
      );
    }
    console.log('');
  }
  if (widerType.length && VERBOSE) {
    console.log(
      '▸ La interfaz del frontend declara campos que el DTO no acepta.\n' +
        '  Son OPCIONALES, así que sólo rompen si el componente pasa la entidad\n' +
        '  entera (típico al editar). Revisar el llamador, no el tipo:',
    );
    for (const x of widerType) {
      console.log(
        `   ${x.verb} ${x.path}  →  ${x.dto}\n     vía:   ${x.via}\n     ancho: ${x.extra.join(', ')}\n     ${x.file}:${x.line}`,
      );
    }
    console.log('');
  }
  if (missingRequired.length) {
    console.log('▸ Campos obligatorios del DTO que el cuerpo no envía:');
    for (const x of missingRequired) {
      console.log(
        `   ${x.verb} ${x.path}  →  ${x.dto}\n     falta: ${x.absent.join(', ')}\n     ${x.file}:${x.line}`,
      );
    }
    console.log('');
  }

  process.exitCode =
    missing.length || wrongVerb.length || extraKeys.length ? 1 : 0;
}

run();
