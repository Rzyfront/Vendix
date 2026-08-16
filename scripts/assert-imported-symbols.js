#!/usr/bin/env node
/**
 * Compuerta léxica: verifica que todo símbolo importado desde un módulo del
 * repo EXISTA en ese módulo.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * El backend compila con **swc**, que transpila sin typechequear. Un
 * `import { X } from './y'` donde `y` ya no exporta `X` no rompe nada al
 * arrancar: el módulo carga, la app llega a health 200 y el grafo de
 * dependencias de Nest resuelve. El fallo aparece en caliente, en la primera
 * petición que toca esa línea, y con la forma menos diagnosticable posible —
 * `X is not a function` o un `undefined` que se propaga en silencio.
 *
 * Eso fue exactamente lo que pasó el 15/08/2026: un `git checkout` accidental
 * dejó `ubl-common.builder.ts` en una revisión anterior mientras sus cuatro
 * consumidores seguían en la nueva. Ocho símbolos importados dejaron de existir.
 * El backend arrancaba perfecto y TODA emisión electrónica devolvía HTTP 500,
 * porque el símbolo ausente estaba en el camino del CUFE.
 *
 * El único gate que lo habría atajado antes es un build completo con `tsc`, y
 * un build de este monorepo deja la máquina de desarrollo sin memoria — por eso
 * el flujo del repo prohíbe correrlos fuera de CI. Este script cubre ese hueco:
 * son unos segundos sobre ~4.000 archivos, sin resolver tipos, sin `tsc` y sin
 * cargar el programa entero.
 *
 * QUÉ COMPRUEBA Y QUÉ NO
 * ----------------------
 * Son DOS compuertas independientes sobre el mismo recorrido:
 *
 * 1. **Imports rotos** — que cada nombre de un `import { … }` con ruta RELATIVA
 *    esté exportado por el archivo destino, siguiendo los `export * from` en
 *    cadena. También el import por defecto contra la ausencia de
 *    `export default`. Es el caso del 15/08/2026 descrito arriba.
 * 2. **Identificadores libres** — un nombre usado que no se declara en el
 *    archivo, ni se importa, ni existe como global ambiental. Es un `TS2304`
 *    puro: ese archivo NO compila. Ver {@link collectFreeIdentifiers}.
 *
 * NO: tipos, firmas, aridad, ni imports de paquetes o de alias de tsconfig
 * (`@common/…`). Esto NO reemplaza al build de CI — lo adelanta para los dos
 * modos de fallo que el desarrollo local no puede ver.
 *
 * Uso:
 *   npm run symbols:audit                 # backend + frontend
 *   node scripts/assert-imported-symbols.js apps/backend/src
 *
 * Sale con código 1 y nombra cada símbolo ausente con sus consumidores.
 */

const path = require('path');
const fs = require('fs');

// `typescript` vive en el node_modules de la raíz del monorepo; el script puede
// invocarse desde cualquier cwd, así que se resuelve desde su propia ubicación.
const ts = require(require.resolve('typescript', {
  paths: [path.resolve(__dirname, '..')],
}));

const DEFAULT_ROOTS = ['apps/backend/src', 'apps/frontend/src'];
const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ROOTS;

/** Todos los `.ts`/`.tsx` bajo un directorio, sin declaraciones ni compilados. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

const parse = (file) =>
  ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

/**
 * Nombres que un módulo exporta.
 *
 * La caché se puebla ANTES de recorrer los `export *` a propósito: un ciclo de
 * reexportaciones —que en este repo existe— colgaría la recursión, y devolver
 * el conjunto a medio llenar sólo puede producir un falso positivo, nunca un
 * falso negativo silencioso.
 */
const exportsCache = new Map();
function exportsOf(file) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  const result = { names: new Set(), starFrom: [], hasDefault: false };
  exportsCache.set(file, result);

  let source;
  try {
    source = parse(file);
  } catch {
    return result;
  }

  for (const statement of source.statements) {
    const is_exported =
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
      false;

    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          result.names.add(element.name.text);
        }
      } else if (!statement.exportClause && statement.moduleSpecifier) {
        result.starFrom.push(statement.moduleSpecifier.text);
      }
      continue;
    }
    if (!is_exported) continue;

    if (
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      result.hasDefault = true;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          result.names.add(declaration.name.text);
        }
      }
    } else if (statement.name && ts.isIdentifier(statement.name)) {
      result.names.add(statement.name.text);
    }
  }

  for (const specifier of result.starFrom) {
    const target = resolveModule(file, specifier);
    if (!target) continue;
    for (const name of exportsOf(target).names) result.names.add(name);
  }
  return result;
}

/**
 * Resuelve un especificador RELATIVO a un archivo del repo.
 *
 * Los alias de tsconfig (`@common/…`, `src/…`) y los paquetes devuelven `null`
 * y quedan fuera del barrido: resolverlos exigiría leer la configuración de
 * cada workspace, y el modo de fallo que este script persigue —un módulo
 * vecino que perdió un export— viaja siempre por ruta relativa.
 */
function resolveModule(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Nombres que existen sin que nadie los declare ni los importe: los globales del
 * lenguaje, del DOM, de Node y de los tipos ambientales instalados.
 *
 * NO se escriben a mano. Se cosechan de los `.d.ts` que ya están en disco —
 * `typescript/lib/lib.*.d.ts` y los paquetes de `@types` que declaran globales—
 * porque una lista manual envejece con cada actualización de dependencias y su
 * envejecimiento produce FALSOS POSITIVOS, que es el modo de fallo que vuelve
 * inútil a una compuerta: en cuanto ladra sin motivo, se ignora.
 *
 * Sobre-recolectar es seguro (a lo sumo deja pasar un error); sub-recolectar no.
 * Por eso el barrido es deliberadamente laxo y se queda con cualquier nombre
 * declarado en cabecera de una declaración ambiental.
 */
const AMBIENT_DECLARATION = new RegExp(
  '^\\s*(?:declare\\s+)?(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?' +
    '(?:var|let|const|function|class|interface|type|enum|namespace|module)\\s+' +
    '([A-Za-z_$][\\w$]*)',
  'gm',
);

function harvestAmbientNames(dir, matches, into) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith('.d.ts')) continue;
    if (matches && !matches.test(entry.name)) continue;
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(AMBIENT_DECLARATION)) into.add(match[1]);
  }
}

function buildAmbientGlobals() {
  const names = new Set([
    // Palabras reservadas que el parser materializa como `Identifier` en
    // posición de tipo: `x as const` y `typeof this.foo`. No pueden ser un
    // nombre real, así que aceptarlas no relaja nada.
    'const',
    'this',
    // Palabras del lenguaje que no son declaraciones en ningún `.d.ts`.
    'globalThis',
    'undefined',
    'arguments',
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
  ]);
  const repo_root = path.resolve(__dirname, '..');

  // Librerías estándar que trae el propio TypeScript: ES*, DOM, WebWorker…
  harvestAmbientNames(
    path.join(path.dirname(require.resolve('typescript', { paths: [repo_root] }))),
    /^lib\..*\.d\.ts$/,
    names,
  );

  // Paquetes de `@types` que declaran globales (node, jest, jasmine…). Se
  // recorre un nivel de subdirectorio porque `@types/node` reparte sus globales
  // en decenas de archivos sueltos.
  const types_dir = path.join(repo_root, 'node_modules', '@types');
  let packages;
  try {
    packages = fs.readdirSync(types_dir, { withFileTypes: true });
  } catch {
    packages = [];
  }
  for (const pkg of packages) {
    if (!pkg.isDirectory()) continue;
    const pkg_dir = path.join(types_dir, pkg.name);
    harvestAmbientNames(pkg_dir, null, names);
    for (const sub of fs.readdirSync(pkg_dir, { withFileTypes: true })) {
      if (sub.isDirectory()) {
        harvestAmbientNames(path.join(pkg_dir, sub.name), null, names);
      }
    }
  }

  // Y los `.d.ts` del PROPIO repo, que declaran globales que ninguna librería
  // trae: `apps/frontend/src/web-serial.d.ts` declara la Web Serial API, que
  // usa la báscula del POS y que no está en `lib.dom`. El barrido de archivos
  // los excluye a propósito (no son código a auditar), así que sin esto un tipo
  // ambiental propio se leería como un identificador inventado.
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved)) continue;
    for (const dir of directoriesUnder(resolved)) {
      harvestAmbientNames(dir, null, names);
    }
  }
  return names;
}

/** Cada subdirectorio bajo `dir`, él incluido, sin `node_modules` ni `dist`. */
function directoriesUnder(dir, out = []) {
  out.push(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    directoriesUnder(path.join(dir, entry.name), out);
  }
  return out;
}

const AMBIENT_GLOBALS = buildAmbientGlobals();

/**
 * SEGUNDA COMPUERTA — un identificador usado y nunca declarado ni importado.
 *
 * POR QUÉ NO BASTA CON LA PRIMERA. La compuerta de imports sólo mira símbolos
 * que alguien pidió a otro módulo. Un identificador **libre** —escrito en el
 * cuerpo del archivo sin importarlo ni declararlo— se le escapa entera.
 *
 * Eso fue lo que pasó con `MAPPING_KEYS_FALLBACK` en
 * `fiscal-accounting-mappings-step.component.ts`: la constante declarada se
 * llamaba `DEFAULT_MAPPING_KEYS` y el componente inicializaba su signal con un
 * nombre que no existía en ningún archivo del repo. Es un `TS2304` — el
 * frontend NO compilaba — y estuvo commiteado sin que nada lo señalara, porque
 * el flujo de este repo prohíbe correr builds en la máquina de desarrollo.
 *
 * POR QUÉ YA NO SE LIMITA A CONSTANT_CASE. La primera versión sólo miraba
 * nombres en mayúsculas, para no arriesgar ruido. Duró poco: en el mismo mes se
 * colaron cuatro TS2304 que ese alfabeto no cubría —`MappingKeyCatalogEntry`
 * usado como tipo sin import, y `ofType` / `Actions` / `firstValueFrom` en un
 * componente de POS—. El modo de fallo no distingue capitalización, así que la
 * compuerta tampoco debe.
 *
 * CÓMO EVITA EL RUIDO, que es lo único que hace útil a una compuerta:
 *
 * 1. El conjunto de "declarado" es **plano por archivo**, no por ámbito. Un
 *    nombre declarado en cualquier punto del archivo cuenta como declarado en
 *    todos. Eso pierde el uso-antes-de-declarar (falso negativo, tolerable) y a
 *    cambio no puede inventar un falso positivo por no modelar ámbitos, que es
 *    justamente el trabajo de resolución de tipos que este script existe para
 *    NO hacer.
 * 2. Los globales ambientales salen de los `.d.ts` en disco, no de una lista
 *    escrita a mano que envejece (ver {@link buildAmbientGlobals}).
 * 3. Se descarta toda posición que no es una LECTURA del identificador: nombres
 *    de declaración, claves de objeto, propiedades tras un punto, el lado
 *    derecho de un nombre calificado y los alias de import/export.
 */
function collectFreeIdentifiers(source, file, out) {
  const declared = new Set();
  const used = new Map();

  const declareBinding = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      declared.add(name.text);
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) declareBinding(element.name);
      }
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) declared.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          declared.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            declared.add(element.name.text);
          }
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node)) declared.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)
    ) {
      declareBinding(node.name);
    }
    // Los parámetros de tipo (`<T>`, `<K extends keyof T>`) son declaraciones
    // igual que una variable, y sin esto TODO genérico del repo sería un
    // hallazgo. La firma que los declara puede estar en cualquier nodo, así que
    // se leen del nodo genéricamente en vez de enumerar sus 12 portadores.
    if (node.typeParameters) {
      for (const parameter of node.typeParameters) {
        declared.add(parameter.name.text);
      }
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isFunctionExpression(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text);
    }
    // Una etiqueta (`outer: for (…) { break outer; }`) se declara y se lee con
    // la misma forma sintáctica que una variable, pero vive en otro espacio de
    // nombres.
    if (ts.isLabeledStatement(node)) declared.add(node.label.text);

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const is_declaration_name = parent && parent.name === node;
      // `A.B` en posición de tipo, y el `.Foo` de un tipo-import
      // (`import('./x').Foo`): en ambos el nombre lo resuelve el módulo de la
      // izquierda, no el ámbito de este archivo.
      const is_qualified =
        parent &&
        ((ts.isQualifiedName(parent) && parent.right === node) ||
          (ts.isImportTypeNode(parent) && parent.qualifier === node));
      const is_property =
        parent &&
        ((ts.isPropertyAccessExpression(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isMethodSignature(parent) ||
          ts.isPropertySignature(parent)) &&
          parent.name === node);
      // `const { day: nowDay } = x` — `day` es la CLAVE del objeto de origen,
      // no un nombre libre. Sin esto, todo destructurado con renombre ladra.
      const is_binding_key =
        parent && ts.isBindingElement(parent) && parent.propertyName === node;
      const is_specifier =
        parent && (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent));
      const is_label =
        parent &&
        (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
        parent.label === node;
      const is_meta =
        parent &&
        (ts.isMetaProperty(parent) ||
          // `{ foo }` abreviado: el nombre es a la vez clave y lectura, y
          // resolverlo pediría el ámbito. Se omite: falso negativo tolerable.
          ts.isShorthandPropertyAssignment(parent) ||
          ts.isJsxAttribute?.(parent));
      if (
        !is_declaration_name &&
        !is_qualified &&
        !is_property &&
        !is_binding_key &&
        !is_specifier &&
        !is_label &&
        !is_meta &&
        !used.has(node.text)
      ) {
        used.set(
          node.text,
          source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);

  for (const [name, line] of used) {
    if (!declared.has(name) && !AMBIENT_GLOBALS.has(name)) {
      out.push({ file, name, line });
    }
  }
}

const findings = [];
const freeFindings = [];
const files = roots.flatMap((root) => {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    console.error(`⚠️  ruta inexistente, se omite: ${root}`);
    return [];
  }
  return walk(resolved);
});

for (const file of files) {
  let source;
  try {
    source = parse(file);
  } catch {
    continue;
  }
  collectFreeIdentifiers(source, file, freeFindings);

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const target = resolveModule(file, statement.moduleSpecifier.text);
    if (!target) continue;

    const { names, hasDefault } = exportsOf(target);
    const clause = statement.importClause;

    if (clause.name && !hasDefault) {
      findings.push({
        file,
        target,
        symbol: `default (importado como ${clause.name.text})`,
      });
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const wanted = (element.propertyName ?? element.name).text;
        if (!names.has(wanted)) findings.push({ file, target, symbol: wanted });
      }
    }
  }
}

const rel = (file) => path.relative(process.cwd(), file);

if (freeFindings.length > 0) {
  console.error(
    `\n❌ ${freeFindings.length} identificador(es) usados y nunca declarados ` +
      `ni importados:\n`,
  );
  for (const finding of freeFindings) {
    console.error(`  ${rel(finding.file)}:${finding.line}  ${finding.name}`);
  }
  console.error(
    `\nEs un TS2304: ese archivo NO compila. Dos causas habituales: falta el\n` +
      `import (se usó el símbolo y nunca se trajo), o el nombre existe en el\n` +
      `mismo archivo con otra grafía (se renombró la declaración o el uso, pero\n` +
      `no ambos).\n`,
  );
}

if (findings.length === 0 && freeFindings.length === 0) {
  console.log(
    `✅ ${files.length} archivos revisados: todo símbolo importado existe en su ` +
      `módulo y no hay constantes usadas sin declarar.`,
  );
  process.exit(0);
}

if (findings.length === 0) process.exit(1);

// El informe se agrupa por MÓDULO DESTINO, no por consumidor: cuando un archivo
// pierde exports, el arreglo está en él y no en los diez que lo importan.
const by_target = new Map();
for (const finding of findings) {
  const key = rel(finding.target);
  if (!by_target.has(key)) by_target.set(key, []);
  by_target.get(key).push(finding);
}

console.error(
  `\n❌ ${findings.length} importación(es) de un símbolo que su módulo NO exporta ` +
    `(${files.length} archivos revisados):\n`,
);
const sorted = [...by_target].sort((a, b) => b[1].length - a[1].length);
for (const [target, group] of sorted) {
  const symbols = [...new Set(group.map((g) => g.symbol))].sort();
  console.error(`  ${target} — le faltan ${symbols.length}:`);
  for (const symbol of symbols) {
    const consumers = group
      .filter((g) => g.symbol === symbol)
      .map((g) => rel(g.file));
    console.error(
      `    · ${symbol}  ← ${consumers.length} consumidor(es): ` +
        `${consumers.slice(0, 3).join(', ')}${consumers.length > 3 ? ', …' : ''}`,
    );
  }
  console.error('');
}
console.error(
  `swc transpila sin typechequear, así que esto NO impide arrancar: el backend\n` +
    `llega a health 200 y falla en caliente, en la primera petición que toca la\n` +
    `línea, con "X is not a function" o un undefined silencioso.\n` +
    `\nCausa habitual: un archivo quedó en una revisión anterior a la de sus\n` +
    `consumidores (merge a medias, checkout accidental, stash aplicado en parte).\n`,
);
process.exit(1);
