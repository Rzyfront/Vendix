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
 * SÍ: que cada nombre de un `import { … }` con ruta RELATIVA esté exportado por
 * el archivo destino, siguiendo los `export * from` en cadena. También el
 * import por defecto contra la ausencia de `export default`.
 *
 * NO: tipos, firmas, aridad, ni imports de paquetes o de alias de tsconfig
 * (`@common/…`). Esto NO reemplaza al build de CI — lo adelanta para el modo de
 * fallo que el desarrollo local no puede ver.
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
 * Nombres globales que un archivo usa sin declarar y sin importar, legítimamente.
 * La lista es corta a propósito: sólo hace falta cubrir los que se escriben en
 * CONSTANT_CASE, que es el alfabeto del barrido de abajo.
 */
const AMBIENT_GLOBALS = new Set(['NaN', 'Infinity', 'JSON', 'Math', 'Intl']);

/** `FOO_BAR`, `MAX_RETRIES_2`: mayúsculas con al menos un guion bajo. */
const CONSTANT_CASE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

/**
 * SEGUNDA COMPUERTA — un identificador CONSTANT_CASE usado y nunca declarado.
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
 * ALCANCE DELIBERADAMENTE ESTRECHO. Sólo CONSTANT_CASE, y sólo dentro del
 * archivo: un nombre en mayúsculas es siempre una constante de módulo o de
 * clase, nunca un global del navegador ni de Node, así que el ruido es cero
 * (verificado sobre los 4.140 archivos del repo). Un barrido general de
 * identificadores exigiría resolver ámbitos y tipos, que es justamente lo que
 * este script existe para NO hacer.
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
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)
    ) {
      declareBinding(node.name);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text);
    }

    if (ts.isIdentifier(node) && CONSTANT_CASE.test(node.text)) {
      const parent = node.parent;
      // Se descarta todo lo que NO es una lectura del identificador: el nombre
      // de cualquier declaración (incluida una propiedad de clase, que fue la
      // fuente de ruido al calibrar esto), el lado derecho de un nombre
      // calificado, y el `propertyName` de un import/export con alias.
      const is_declaration_name = parent && parent.name === node;
      const is_qualified =
        parent && ts.isQualifiedName(parent) && parent.right === node;
      const is_specifier =
        parent && (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent));
      if (!is_declaration_name && !is_qualified && !is_specifier) {
        if (!used.has(node.text)) {
          used.set(
            node.text,
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          );
        }
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
    `\n❌ ${freeFindings.length} identificador(es) CONSTANT_CASE usados y nunca ` +
      `declarados ni importados:\n`,
  );
  for (const finding of freeFindings) {
    console.error(`  ${rel(finding.file)}:${finding.line}  ${finding.name}`);
  }
  console.error(
    `\nEs un TS2304: ese archivo NO compila. Causa habitual: la constante existe\n` +
      `con otro nombre en el mismo archivo (se renombró la declaración o el uso,\n` +
      `pero no ambos).\n`,
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
