#!/usr/bin/env node
/**
 * Genera los catálogos geográficos de la DIAN desde las fuentes oficiales de la
 * Caja de Herramientas, en vez de mantenerlos a mano.
 *
 * POR QUÉ EXISTE
 * --------------
 * `dian-geography.ts` transporta 33 departamentos y 1122 municipios con su
 * código postal. Esos datos se extrajeron una vez de las listas oficiales y
 * quedaron como código. El problema no es la extracción inicial —está
 * verificada— sino lo que pasa después: cuando la DIAN republica la Caja de
 * Herramientas, nadie tiene forma de saber si el catálogo del repo sigue
 * coincidiendo con el oficial. Un municipio renombrado o un código postal
 * movido no rompe ninguna compilación ni ningún test: produce una dirección
 * declarada con un dato que la DIAN ya no reconoce, y el rechazo llega
 * DESPUÉS de gastar el consecutivo autorizado (reglas FAJ29 / FAJ32).
 *
 * Por eso el modo importante de este script no es `--write` sino `--check`:
 * convierte «¿seguirá vigente el catálogo?» en una comprobación que falla,
 * apta para CI, en vez de una pregunta que nadie se hace.
 *
 * QUÉ GENERA, Y DESDE QUÉ FUENTE
 * ------------------------------
 *   DIAN_DEPARTMENTS       ← `Listas de valores/Departamentos-2.1.gc`
 *   MUNICIPALITIES_RAW     ← `Listas de valores/Municipio-2.1.gc`
 *                            + `Anexo Tecnico/Codigos_Postales.xlsx`
 *   DIAN_MUNICIPALITY_COUNT← cardinalidad de lo anterior
 *
 * El código postal es el URBANO MÁS BAJO de cada municipio. Es el mismo
 * criterio con el que se extrajo el catálogo a mano —determinista y
 * reproducible— y se comprueba contra el caso conocido: 11001 → 110111, que es
 * el valor que el builder UBL traía cableado para Bogotá.
 *
 * QUÉ *NO* GENERA, Y POR QUÉ
 * --------------------------
 * `dian-tax-level-codes.ts` NO se genera desde la Caja de Herramientas, y es
 * deliberado: `cbc:TaxLevelCode` acepta una enumeración CORTA que no es el
 * catálogo de la casilla 53 del RUT, aunque ambos compartan el prefijo `O-`.
 * Generarlo desde la lista amplia es exactamente lo que produjo el rechazo
 * FAJ26 «Responsabilidad informada por emisor no válida según lista». Ese
 * archivo se mantiene a mano, con su procedencia documentada.
 *
 * `dian-document-types.ts` tampoco: sus tablas viven en el PDF del Anexo
 * Técnico 1.9, no en el ZIP (que es de la 1.8). Extraerlas de un PDF con
 * heurísticas sería una fuente de verdad peor que la revisión humana.
 *
 * LA CAJA DE HERRAMIENTAS NO ESTÁ EN EL REPO
 * ------------------------------------------
 * Son 22 MB de ZIP. Se descarga de:
 *
 *   https://www.dian.gov.co/impuestos/factura-electronica/Documents/Caja_de_herramientas_Factura_Electronica_Validacion_Previa.zip
 *
 * (el espejo de `micrositios.dian.gov.co` responde 502 — usar el de
 * `dian.gov.co`). Se descomprime en cualquier sitio y se le pasa la ruta:
 *
 *   node scripts/generate-dian-catalogs.js --caja=/ruta/a/la/caja --check
 *
 * El script busca hacia abajo desde esa ruta hasta encontrar el directorio que
 * contenga `Listas de valores/` y `Anexo Tecnico/`, así que da igual si se
 * apunta a la raíz del ZIP descomprimido o a la carpeta `Version 1.8`.
 * También se acepta la variable de entorno `DIAN_CAJA_DIR`.
 *
 * USO
 *   node scripts/generate-dian-catalogs.js --caja=<dir> --check   # falla si hay deriva
 *   node scripts/generate-dian-catalogs.js --caja=<dir> --print   # imprime el bloque
 *   node scripts/generate-dian-catalogs.js --caja=<dir> --write   # reescribe el .ts
 *
 *   DIAN_CAJA_DIR=<dir> npm run dian:catalogs:check               # equivalente
 *
 * `--check` es el modo por defecto y compara por CONTENIDO —los 33 pares
 * código→departamento y los 1122 registros `código|nombre|postal`—, no por
 * texto. El porqué está en `parseTargetFile`.
 *
 * `--write` sustituye SÓLO las tres regiones de datos, delimitadas por sus
 * anclas sintácticas; la prosa que documenta el archivo no se toca. Después de
 * escribir, se vuelve a leer y a comparar: si el round-trip no coincide, el
 * archivo se restaura y el script falla, porque un generador que deja el
 * catálogo a medias es peor que no tenerlo.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'apps/backend');
const TARGET_FILE = path.join(
  BACKEND_ROOT,
  'src/domains/store/invoicing/providers/dian-direct/constants/dian-geography.ts',
);

/**
 * `xlsx` es dependencia del backend, no de la raíz. Se resuelve desde ahí para
 * no depender del hoisting de npm workspaces, que cambia según el orden de
 * instalación.
 */
function loadXlsx() {
  const require_from_backend = require('module').createRequire(
    path.join(BACKEND_ROOT, 'package.json'),
  );
  try {
    return require_from_backend('xlsx');
  } catch {
    fail(
      'Falta la dependencia `xlsx`. Instala las dependencias del backend:\n' +
        '  npm install -w apps/backend',
    );
  }
}

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Localización de las fuentes
// ---------------------------------------------------------------------------

/**
 * Un directorio sirve como raíz de la Caja si tiene a la vez `Listas de
 * valores` y `Anexo Tecnico`. Se busca en anchura y con tope de profundidad
 * porque el ZIP oficial trae un nivel intermedio cuyo nombre incluye un espacio
 * final (`...Validacion_Previa /Version 1.8`), y ese detalle se pierde al
 * copiar la ruta a mano.
 */
function resolveCajaRoot(start) {
  const MAX_DEPTH = 4;
  const queue = [[start, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = new Set(
      entries.filter((e) => e.isDirectory()).map((e) => e.name.trim()),
    );
    if (names.has('Listas de valores') && names.has('Anexo Tecnico')) return dir;
    if (depth >= MAX_DEPTH) continue;
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push([path.join(dir, entry.name), depth + 1]);
    }
  }
  return null;
}

/** Resuelve un hijo por nombre tolerando espacios sobrantes en el directorio. */
function childByName(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hit = entries.find((e) => e.name.trim() === name.trim());
  return hit ? path.join(dir, hit.name) : null;
}

// ---------------------------------------------------------------------------
// Lectura de las fuentes
// ---------------------------------------------------------------------------

/**
 * Lee un `.gc` (OASIS genericode). Se parsea con expresión regular a propósito:
 * el formato es plano y generado por máquina —`<Row>` con `<Value
 * ColumnRef="…"><SimpleValue>`— y meter un parser XML sólo para esto añadiría
 * una dependencia a un script que corre a mano. Si la DIAN cambiara la forma
 * del archivo, el conteo esperado de filas lo delataría de inmediato.
 */
function readGenericode(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const rows = [];
  const row_re = /<Row>([\s\S]*?)<\/Row>/g;
  const value_re =
    /<Value\s+ColumnRef="([^"]+)"\s*>\s*<SimpleValue>([\s\S]*?)<\/SimpleValue>/g;
  let row_match;
  while ((row_match = row_re.exec(xml)) !== null) {
    const row = {};
    let value_match;
    value_re.lastIndex = 0;
    while ((value_match = value_re.exec(row_match[1])) !== null) {
      row[value_match[1]] = decodeXmlEntities(value_match[2].trim());
    }
    rows.push(row);
  }
  if (rows.length === 0) fail(`\`${path.basename(file)}\` no produjo ninguna fila.`);
  return rows;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Códigos postales por municipio. El `.xlsx` trae una fila por código postal
 * (urbano y rural), así que hay varias por municipio; se conserva el URBANO más
 * bajo. Si un municipio no tuviera ninguna fila urbana se cae al rural más bajo
 * antes que dejarlo sin código: `cbc:PostalZone` es opcional, pero omitirlo en
 * unos municipios y no en otros produce direcciones inconsistentes.
 */
function readPostalCodes(file, XLSX) {
  const workbook = XLSX.readFile(file);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col_municipality = header.indexOf('codigo_municipio');
  const col_postal = header.indexOf('codigo_postal');
  const col_kind = header.indexOf('tipo');
  if (col_municipality < 0 || col_postal < 0 || col_kind < 0) {
    fail(
      `\`${path.basename(file)}\` no tiene las columnas esperadas ` +
        '(codigo_municipio, codigo_postal, tipo). Cabecera leída: ' +
        header.join(', '),
    );
  }

  const urban = new Map();
  const rural = new Map();
  for (const row of rows.slice(1)) {
    const municipality = String(row[col_municipality] ?? '').padStart(5, '0');
    const postal = String(row[col_postal] ?? '').padStart(6, '0');
    if (!/^\d{5}$/.test(municipality) || !/^\d{6}$/.test(postal)) continue;
    const bucket = String(row[col_kind] ?? '').trim().toLowerCase() === 'urbano'
      ? urban
      : rural;
    const current = bucket.get(municipality);
    if (current === undefined || postal < current) bucket.set(municipality, postal);
  }
  return { urban, rural };
}

// ---------------------------------------------------------------------------
// Construcción del catálogo
// ---------------------------------------------------------------------------

function buildCatalog(caja_root, XLSX) {
  const lists_dir = childByName(caja_root, 'Listas de valores');
  const annex_dir = childByName(caja_root, 'Anexo Tecnico');

  const departments_file = childByName(lists_dir, 'Departamentos-2.1.gc');
  const municipalities_file = childByName(lists_dir, 'Municipio-2.1.gc');
  const postal_file = childByName(annex_dir, 'Codigos_Postales.xlsx');
  for (const [label, file] of [
    ['Departamentos-2.1.gc', departments_file],
    ['Municipio-2.1.gc', municipalities_file],
    ['Codigos_Postales.xlsx', postal_file],
  ]) {
    if (!file) fail(`No se encontró \`${label}\` bajo ${caja_root}`);
  }

  // Departamentos, ordenados por código: el orden del `.gc` es arbitrario
  // (Amazonas primero) y un orden inestable convierte cada regeneración en un
  // diff completo que nadie puede revisar.
  const departments = readGenericode(departments_file)
    .map((row) => ({ code: String(row.code).padStart(2, '0'), name: row.name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const { urban, rural } = readPostalCodes(postal_file, XLSX);

  const municipalities = readGenericode(municipalities_file)
    .map((row) => {
      const code = String(row.code).padStart(5, '0');
      return {
        code,
        name: row.name,
        postal_code: urban.get(code) ?? rural.get(code) ?? '',
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const without_postal = municipalities.filter((m) => m.postal_code === '');
  const department_codes = new Set(departments.map((d) => d.code));
  const orphans = municipalities.filter(
    (m) => !department_codes.has(m.code.slice(0, 2)),
  );

  return { departments, municipalities, without_postal, orphans };
}

/**
 * Invariantes que deben cumplirse ANTES de escribir nada. Cada una corresponde
 * a un supuesto del que depende `dian-geography.ts`; si alguna deja de valer,
 * el catálogo generado sería silenciosamente peor que el que ya está.
 */
function assertInvariants(catalog) {
  const problems = [];
  if (catalog.departments.length !== 33) {
    problems.push(`departamentos: ${catalog.departments.length}, se esperaban 33`);
  }
  if (catalog.municipalities.length !== 1122) {
    problems.push(`municipios: ${catalog.municipalities.length}, se esperaban 1122`);
  }
  if (catalog.orphans.length > 0) {
    // `dian-geography.ts` NO almacena el departamento: lo deriva de los 2
    // primeros dígitos del código DANE. Un municipio huérfano rompe esa
    // derivación en runtime, no aquí.
    problems.push(
      `municipios cuyo prefijo no es un departamento conocido: ` +
        catalog.orphans.map((m) => `${m.code} ${m.name}`).join(', '),
    );
  }
  const bogota = catalog.municipalities.find((m) => m.code === '11001');
  if (!bogota || bogota.postal_code !== '110111') {
    problems.push(
      `11001 debería resolver a 110111 (el valor que el builder traía cableado), ` +
        `resolvió a ${bogota ? bogota.postal_code : 'nada'}`,
    );
  }
  if (catalog.without_postal.length > 0) {
    problems.push(
      `${catalog.without_postal.length} municipios sin código postal: ` +
        catalog.without_postal
          .slice(0, 5)
          .map((m) => `${m.code} ${m.name}`)
          .join(', '),
    );
  }
  if (problems.length > 0) {
    fail(
      'Las fuentes oficiales no cumplen las invariantes del catálogo:\n  - ' +
        problems.join('\n  - '),
    );
  }
}

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

function renderDepartments(departments) {
  const body = departments
    .map((d) => `  '${d.code}': ${quote(d.name)},`)
    .join('\n');
  return `export const DIAN_DEPARTMENTS = {\n${body}\n} as const satisfies Readonly<Record<string, string>>;`;
}

function renderMunicipalities(municipalities) {
  const payload = municipalities
    .map((m) => `${m.code}|${m.name}|${m.postal_code}`)
    .join(';');
  // Una sola línea: prettier la parte en tramos de 80 columnas, y así el
  // formato lo fija la herramienta del repo en vez de una heurística de este
  // script que se desincronizaría con `.prettierrc`.
  return `const MUNICIPALITIES_RAW =\n  ${quote(payload)};`;
}

/** Comillas simples con escape, que es el estilo de `.prettierrc` del backend. */
function quote(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Sustituye una región delimitada por su ancla de apertura y su terminador.
 * Falla si el ancla no aparece exactamente una vez: un reemplazo parcial sobre
 * un catálogo es peor que no reemplazar nada.
 */
function replaceRegion(source, open_anchor, close_anchor, replacement, label) {
  const start = source.indexOf(open_anchor);
  if (start === -1) fail(`No se encontró el ancla de \`${label}\` en el archivo destino.`);
  if (source.indexOf(open_anchor, start + 1) !== -1) {
    fail(`El ancla de \`${label}\` aparece más de una vez; no se puede sustituir sin ambigüedad.`);
  }
  const end = source.indexOf(close_anchor, start);
  if (end === -1) fail(`No se encontró el cierre de \`${label}\`.`);
  return source.slice(0, start) + replacement + source.slice(end + close_anchor.length);
}

function renderFile(source, catalog) {
  let output = replaceRegion(
    source,
    'export const DIAN_DEPARTMENTS = {',
    '} as const satisfies Readonly<Record<string, string>>;',
    renderDepartments(catalog.departments),
    'DIAN_DEPARTMENTS',
  );
  // El terminador lleva el salto de línea a propósito. Sin él, `';` casa dentro
  // del propio catálogo: prettier parte la cadena en tramos de 80 columnas y un
  // corte puede caer justo antes de un separador, dejando en el archivo la
  // secuencia `' +\n  ';15810|Tipacoque|…`. Buscar `';` a secas encontraba ese
  // corte —a un tercio del catálogo— y truncaba la cadena ahí. Con `;` siempre
  // seguido de un dígito dentro del payload, `';\n` sólo puede ser el final real
  // de la sentencia.
  output = replaceRegion(
    output,
    'const MUNICIPALITIES_RAW =',
    "';\n",
    renderMunicipalities(catalog.municipalities) + '\n',
    'MUNICIPALITIES_RAW',
  );
  output = output.replace(
    /export const DIAN_MUNICIPALITY_COUNT = \d+;/,
    `export const DIAN_MUNICIPALITY_COUNT = ${catalog.municipalities.length};`,
  );
  return output;
}

/**
 * Lee del archivo destino los datos que este script genera, para poder
 * compararlos por CONTENIDO.
 *
 * `--check` NO compara texto. Se intentó y no sirve: prettier reparte
 * `MUNICIPALITIES_RAW` en tramos de 80 columnas, y el reparto que produce al
 * formatear el archivo entero no es el mismo que produce al formatear sólo la
 * sentencia regenerada. El resultado eran 36 líneas de diff con los 1122
 * registros IDÉNTICOS — una alarma cosmética, que es la forma más rápida de que
 * nadie vuelva a correr el script y de que una deriva real pase inadvertida
 * entre el ruido.
 *
 * Lo que importa es el dato: los 33 pares código→departamento, los 1122
 * registros `código|nombre|postal`, y el conteo declarado.
 */
function parseTargetFile(source) {
  const departments = new Map();
  const departments_block = source.slice(
    source.indexOf('export const DIAN_DEPARTMENTS = {'),
    source.indexOf('} as const satisfies Readonly<Record<string, string>>;'),
  );
  const department_re = /'(\d{2})':\s*'((?:[^'\\]|\\.)*)'/g;
  let match;
  while ((match = department_re.exec(departments_block)) !== null) {
    departments.set(match[1], unquote(match[2]));
  }

  const raw_start = source.indexOf('const MUNICIPALITIES_RAW =');
  const raw_end = source.indexOf("';\n", raw_start);
  if (raw_start === -1 || raw_end === -1) {
    fail('No se pudo localizar `MUNICIPALITIES_RAW` en el archivo destino.');
  }
  // Reconstruye la cadena desde sus tramos: cada línea es `'…' +`, la última
  // `'…';`. Se quita el envoltorio y se concatena, que es lo que hace el motor
  // de JS al evaluar la expresión.
  const municipalities = source
    .slice(raw_start, raw_end + 2)
    .replace(/^const MUNICIPALITIES_RAW =\s*/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^'/, '').replace(/'\s*(\+|;)?$/, ''))
    .join('');

  const count_match = source.match(/export const DIAN_MUNICIPALITY_COUNT = (\d+);/);

  return {
    departments,
    municipalities,
    count: count_match ? Number(count_match[1]) : null,
  };
}

function unquote(text) {
  return text.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

/**
 * Compara lo generado contra lo que el archivo declara hoy y devuelve las
 * diferencias en términos de catálogo, no de líneas: qué municipio cambió de
 * nombre, cuál de código postal, cuál entró y cuál salió. Es la información con
 * la que se decide si la deriva se acepta.
 */
function diffCatalog(catalog, current) {
  const differences = [];

  for (const department of catalog.departments) {
    const existing = current.departments.get(department.code);
    if (existing === undefined) {
      differences.push(`departamento nuevo: ${department.code} ${department.name}`);
    } else if (existing !== department.name) {
      differences.push(
        `departamento ${department.code}: '${existing}' → '${department.name}'`,
      );
    }
  }
  const generated_department_codes = new Set(
    catalog.departments.map((d) => d.code),
  );
  for (const [code, name] of current.departments) {
    if (!generated_department_codes.has(code)) {
      differences.push(`departamento que ya no está en la fuente: ${code} ${name}`);
    }
  }

  const current_municipalities = new Map();
  for (const record of current.municipalities.split(';')) {
    const [code, name, postal] = record.split('|');
    if (code) current_municipalities.set(code, { name, postal });
  }
  for (const municipality of catalog.municipalities) {
    const existing = current_municipalities.get(municipality.code);
    if (existing === undefined) {
      differences.push(
        `municipio nuevo: ${municipality.code} ${municipality.name}`,
      );
      continue;
    }
    if (existing.name !== municipality.name) {
      differences.push(
        `municipio ${municipality.code}: nombre '${existing.name}' → '${municipality.name}'`,
      );
    }
    if (existing.postal !== municipality.postal_code) {
      differences.push(
        `municipio ${municipality.code} (${municipality.name}): código postal ` +
          `${existing.postal} → ${municipality.postal_code}`,
      );
    }
  }
  const generated_municipality_codes = new Set(
    catalog.municipalities.map((m) => m.code),
  );
  for (const [code, value] of current_municipalities) {
    if (!generated_municipality_codes.has(code)) {
      differences.push(
        `municipio que ya no está en la fuente: ${code} ${value.name}`,
      );
    }
  }

  if (current.count !== catalog.municipalities.length) {
    differences.push(
      `DIAN_MUNICIPALITY_COUNT declara ${current.count} y la fuente tiene ` +
        `${catalog.municipalities.length}`,
    );
  }

  return differences;
}

/**
 * Formatea con el prettier del repo, para que `--write` deje el archivo con el
 * mismo estilo que el resto del backend y no con el que improvise este script.
 */
function formatWithPrettier(source) {
  try {
    return execFileSync(
      'npx',
      ['--no-install', 'prettier', '--parser', 'typescript'],
      { input: source, cwd: BACKEND_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    fail(
      'No se pudo formatear con prettier. Instala las dependencias del backend ' +
        `(npm install -w apps/backend).\n${error.stderr || error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--write')
    ? 'write'
    : argv.includes('--print')
      ? 'print'
      : 'check';

  const caja_arg = argv.find((a) => a.startsWith('--caja='));
  const caja_input = caja_arg
    ? caja_arg.slice('--caja='.length)
    : process.env.DIAN_CAJA_DIR;
  if (!caja_input) {
    fail(
      'Falta la ruta a la Caja de Herramientas.\n' +
        '  node scripts/generate-dian-catalogs.js --caja=<dir> [--check|--print|--write]\n' +
        '  (o exporta DIAN_CAJA_DIR)\n\n' +
        'Descarga: https://www.dian.gov.co/impuestos/factura-electronica/Documents/' +
        'Caja_de_herramientas_Factura_Electronica_Validacion_Previa.zip',
    );
  }
  const caja_root = resolveCajaRoot(path.resolve(caja_input));
  if (!caja_root) {
    fail(
      `No se encontró bajo \`${caja_input}\` ningún directorio que contenga a la vez ` +
        '`Listas de valores/` y `Anexo Tecnico/`. ¿Está descomprimido el ZIP?',
    );
  }

  const XLSX = loadXlsx();
  const catalog = buildCatalog(caja_root, XLSX);
  assertInvariants(catalog);

  const current_source = fs.readFileSync(TARGET_FILE, 'utf8');
  const relative_target = path.relative(REPO_ROOT, TARGET_FILE);

  if (mode === 'print') {
    process.stdout.write(renderDepartments(catalog.departments) + '\n\n');
    process.stdout.write(renderMunicipalities(catalog.municipalities) + '\n\n');
    process.stdout.write(
      `export const DIAN_MUNICIPALITY_COUNT = ${catalog.municipalities.length};\n`,
    );
    return;
  }

  const differences = diffCatalog(catalog, parseTargetFile(current_source));

  if (mode === 'check') {
    if (differences.length === 0) {
      process.stdout.write(
        `✓ ${relative_target} coincide con las fuentes oficiales: ` +
          `${catalog.departments.length} departamentos, ` +
          `${catalog.municipalities.length} municipios, mismos nombres y códigos postales.\n`,
      );
      return;
    }
    process.stderr.write(
      `\n✗ ${relative_target} difiere de la Caja de Herramientas de ${caja_root} ` +
        `en ${differences.length} punto(s):\n  - ` +
        differences.slice(0, 40).join('\n  - ') +
        (differences.length > 40 ? `\n  … y ${differences.length - 40} más` : '') +
        '\n\n  Revisa el control de cambios del Anexo Técnico antes de aceptar la deriva:\n' +
        '  un municipio renombrado o un código postal movido cambia lo que se declara\n' +
        '  en `cbc:CityName` / `cbc:PostalZone`, y la DIAN lo valida (FAJ29 / FAJ32).\n' +
        '  Para aplicarla: node scripts/generate-dian-catalogs.js --caja=<dir> --write\n\n',
    );
    process.exit(1);
  }

  // --write. Si no hay diferencias de DATO no se toca el archivo: reescribirlo
  // sólo produciría un diff de reparto de tramos —prettier no reparte igual una
  // sentencia suelta que el archivo entero— y ensuciaría la revisión sin
  // cambiar un solo municipio.
  if (differences.length === 0) {
    process.stdout.write(
      `✓ ${relative_target} ya estaba al día; no se cambió nada.\n`,
    );
    return;
  }

  const generated = formatWithPrettier(renderFile(current_source, catalog));
  fs.writeFileSync(TARGET_FILE, generated, 'utf8');

  // Round-trip: se relee lo escrito y se vuelve a comparar contra la fuente. Si
  // el archivo en disco no reproduce el catálogo, se restaura el original —un
  // generador que deja el catálogo a medias es peor que no tenerlo.
  const rewritten = diffCatalog(catalog, parseTargetFile(fs.readFileSync(TARGET_FILE, 'utf8')));
  if (rewritten.length > 0) {
    fs.writeFileSync(TARGET_FILE, current_source, 'utf8');
    fail(
      'El archivo escrito no reproduce el catálogo generado; se restauró el ' +
        `original. Primer desajuste: ${rewritten[0]}`,
    );
  }

  process.stdout.write(
    `✓ ${relative_target} regenerado desde ${caja_root} ` +
      `(${differences.length} cambio(s) aplicado(s)).\n`,
  );
}

main();
