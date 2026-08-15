#!/usr/bin/env node
/**
 * Compila los XSD oficiales de la DIAN a un modelo de contenido en TypeScript.
 *
 * POR QUÉ NO SE LEEN LOS .xsd EN RUNTIME
 * --------------------------------------
 * El `Dockerfile` del backend copia a la imagen final sólo `dist/`,
 * `node_modules/`, `prisma/` y `package*.json`, y `nest-cli.json` no declara
 * `assets`. Un `.xsd` bajo `src/` nunca llega a la imagen: `readFileSync`
 * compilaría, pasaría en desarrollo con `swc` en watch, y lanzaría `ENOENT` la
 * primera vez que alguien facture en producción. Compilar el esquema a un
 * módulo `.ts` lo hace viajar como código, que es lo único que la imagen sí
 * transporta.
 *
 * QUÉ SE EXTRAE
 * -------------
 * El modelo de contenido y nada más: para cada `xsd:complexType`, la secuencia
 * ordenada de hijos con su `minOccurs`/`maxOccurs`; y para cada elemento global,
 * el tipo que le corresponde. Eso alcanza para detectar la clase de fallo que el
 * builder UBL puede tener y ningún test de contenido ve: un elemento emitido
 * fuera del orden que fija la secuencia, o uno obligatorio que falta.
 *
 * Las facetas de tipos simples (patrones, longitudes, rangos) NO se extraen: las
 * cubre `FiscalDocumentValidator`, que además responde en español citando la
 * regla del Anexo Técnico en vez de un error de esquema.
 *
 * USO
 *   node scripts/generate-dian-ubl-content-model.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(
  REPO_ROOT,
  'apps/backend/src/domains/store/invoicing/providers/dian-direct/schemas',
);
const OUT_FILE = path.join(
  REPO_ROOT,
  'apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-ubl-content-model.ts',
);

/**
 * Documentos raíz que Vendix emite. La extracción arranca de aquí y sigue las
 * referencias: generar los ~4.000 tipos de UBL completo produciría un archivo
 * enorme del que usaríamos una fracción.
 */
const ROOT_DOCUMENTS = [
  { file: 'maindoc/UBL-Invoice-2.1.xsd', element: 'Invoice' },
  { file: 'maindoc/UBL-CreditNote-2.1.xsd', element: 'CreditNote' },
  { file: 'maindoc/UBL-DebitNote-2.1.xsd', element: 'DebitNote' },
  { file: 'maindoc/UBL-ApplicationResponse-2.1.xsd', element: 'ApplicationResponse' },
  { file: 'maindoc/UBL-AttachedDocument-2.1.xsd', element: 'AttachedDocument' },
];

// ── Parseo ────────────────────────────────────────────────────────────────
//
// Los XSD de UBL usan un subconjunto muy estrecho y regular del lenguaje:
// `xsd:element` con `name`/`type` o con `ref`/`minOccurs`/`maxOccurs`, dentro de
// `xsd:sequence` dentro de `xsd:complexType[@name]`. No hay `choice`, ni `all`,
// ni grupos sustituibles, ni `xsd:extension` con contenido complejo. Un lector
// por expresiones regulares sobre esa forma es suficiente y evita meter una
// dependencia de parseo XML en un script de autoría.
//
// El lector VERIFICA su propia premisa: si aparece un `xsd:choice`, `xsd:all` o
// `xsd:group` dentro de un tipo que vamos a emitir, aborta en vez de generar un
// modelo silenciosamente incompleto.

/** Quita comentarios y bloques `xsd:annotation`, que son el 90% del archivo. */
function stripNoise(xml) {
  return xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<xsd:annotation\b[\s\S]*?<\/xsd:annotation>/g, '');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/**
 * @returns {{globalElements: Map<string,string>, complexTypes: Map<string, Array>}}
 */
function parseSchemas() {
  const global_elements = new Map(); // 'cbc:ID' -> 'IDType' (qname → nombre de tipo)
  const complex_types = new Map(); // 'InvoiceType' -> [{ref, min, max}]
  const unsupported = new Map(); // tipo → dónde rompe la premisa

  const files = [];
  for (const sub of ['common', 'maindoc']) {
    const dir = path.join(SCHEMA_DIR, sub);
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.endsWith('.xsd')) files.push(path.join(sub, f));
    }
  }

  for (const rel of files) {
    const raw = fs.readFileSync(path.join(SCHEMA_DIR, rel), 'utf8');
    const xml = stripNoise(raw);

    // Prefijo canónico del targetNamespace de ESTE archivo: los elementos que
    // declara se referencian desde otros como `<prefijo>:<nombre>`.
    const target_ns = attr(
      xml.match(/<xsd:schema\b[^>]*>/)?.[0] ?? '',
      'targetNamespace',
    );
    const prefix = prefixForNamespace(target_ns);

    // 1. Elementos globales: <xsd:element name="X" type="Y">
    const el_re = /<xsd:element\b([^>]*?)\/?>/g;
    let m;
    while ((m = el_re.exec(xml)) !== null) {
      const tag = m[1];
      const name = attr(tag, 'name');
      const type = attr(tag, 'type');
      if (!name || !type) continue;
      // Sólo los de nivel superior: los anidados llevan minOccurs/maxOccurs o
      // viven dentro de un complexType. UBL declara todo global, así que basta
      // con exigir que no traiga cardinalidad.
      if (attr(tag, 'minOccurs') !== null || attr(tag, 'maxOccurs') !== null) {
        continue;
      }
      if (prefix) global_elements.set(`${prefix}:${name}`, stripPrefix(type));
    }

    // 2. Tipos complejos con su secuencia.
    const ct_re = /<xsd:complexType\b([^>]*)>([\s\S]*?)<\/xsd:complexType>/g;
    while ((m = ct_re.exec(xml)) !== null) {
      const type_name = attr(m[1], 'name');
      if (!type_name) continue;
      const body = m[2];

      if (/<xsd:(choice|all|group)\b/.test(body)) {
        // No se aborta aquí: casi todos los infractores viven en XAdES, que
        // describe la firma digital y nunca se alcanza desde un documento que
        // construyamos nosotros (la firma entra bajo `ext:ExtensionContent`,
        // que es `xsd:any`). Se anota y se decide DESPUÉS de calcular el
        // alcance: sólo importa si el modelo que emitimos depende de uno.
        unsupported.set(type_name, `${rel}: ${type_name} usa xsd:choice/all/group`);
        continue;
      }

      const children = [];
      const child_re = /<xsd:element\b([^>]*?)\/?>/g;
      let c;
      while ((c = child_re.exec(body)) !== null) {
        const raw_ref = attr(c[1], 'ref');
        if (!raw_ref) continue; // los hijos de UBL siempre son por referencia
        // Un `ref` SIN prefijo apunta al targetNamespace del propio archivo, no
        // a un namespace vacío. `UBL-CommonExtensionComponents-2.1.xsd` es el
        // caso real: declara `ref="UBLExtension"` a secas y el XML lo emite como
        // `ext:UBLExtension`. Dejarlo crudo produce un modelo que no reconoce su
        // propio hijo obligatorio, y el validador rechaza como inválido cualquier
        // documento —incluidos los ejemplos oficiales de la DIAN—.
        const ref =
          raw_ref.includes(':') || !prefix ? raw_ref : `${prefix}:${raw_ref}`;
        const min = attr(c[1], 'minOccurs');
        const max = attr(c[1], 'maxOccurs');
        children.push({
          ref,
          min: min === null ? 1 : Number(min),
          max: max === null ? 1 : max === 'unbounded' ? Infinity : Number(max),
        });
      }
      if (children.length > 0) complex_types.set(type_name, children);
    }
  }

  return { global_elements, complex_types, unsupported };
}

function stripPrefix(qname) {
  const i = qname.indexOf(':');
  return i === -1 ? qname : qname.slice(i + 1);
}

/** Namespace → prefijo canónico, el mismo que emite `xml-namespaces.ts`. */
function prefixForNamespace(ns) {
  if (!ns) return null;
  const map = {
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2': 'cac',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2': 'cbc',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2': 'ext',
    'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2': 'sig',
    'dian:gov:co:facturaelectronica:Structures-2-1': 'sts',
    'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2': 'Invoice',
    'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2': 'CreditNote',
    'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2': 'DebitNote',
    'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2': 'ApplicationResponse',
    'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2': 'AttachedDocument',
  };
  return map[ns] ?? null;
}

// ── Alcance ───────────────────────────────────────────────────────────────

/**
 * Tipos alcanzables desde las raíces, siguiendo `ref` → elemento → tipo.
 *
 * Devuelve además los tipos alcanzados cuyo modelo el lector NO supo extraer.
 * Un tipo así no se distingue de un tipo simple mirando sólo el mapa —ambos
 * están ausentes—, y esa confusión emitiría un modelo con un agujero que el
 * validador leería como «elemento opaco, no revisar». Se separan para poder
 * abortar en vez de generar una validación que miente sobre su cobertura.
 */
function reachableTypes(root_type_names, global_elements, complex_types, unsupported) {
  const seen = new Set();
  const hit_unsupported = new Set();
  const queue = [...root_type_names];
  while (queue.length > 0) {
    const type_name = queue.pop();
    if (!type_name || seen.has(type_name)) continue;
    if (unsupported.has(type_name)) {
      hit_unsupported.add(type_name);
      continue;
    }
    const children = complex_types.get(type_name);
    if (!children) continue; // tipo simple: sin modelo de contenido que validar
    seen.add(type_name);
    for (const child of children) {
      const child_type = global_elements.get(child.ref);
      if (child_type && !seen.has(child_type)) queue.push(child_type);
    }
  }
  return { reachable: seen, hit_unsupported };
}

// ── Emisión ───────────────────────────────────────────────────────────────

function main() {
  const { global_elements, complex_types, unsupported } = parseSchemas();

  const roots = [];
  for (const { file, element } of ROOT_DOCUMENTS) {
    const xml = stripNoise(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
    const m = xml.match(
      new RegExp(`<xsd:element\\s+name="${element}"\\s+type="([^"]+)"`),
    );
    if (!m) throw new Error(`No se encontró el elemento raíz ${element} en ${file}`);
    roots.push({ element, type: stripPrefix(m[1]) });
  }

  const { reachable, hit_unsupported } = reachableTypes(
    roots.map((r) => r.type),
    global_elements,
    complex_types,
    unsupported,
  );

  if (hit_unsupported.size > 0) {
    throw new Error(
      'El lector asume que los XSD de UBL sólo usan xsd:sequence, y un tipo que ' +
        'SÍ alcanzamos rompe esa premisa. Generar igual produciría un modelo con ' +
        'un agujero invisible. Revisar:\n  - ' +
        [...hit_unsupported].map((t) => unsupported.get(t)).join('\n  - '),
    );
  }

  // Sólo los elementos que alguien alcanzable referencia.
  const used_elements = new Map();
  for (const type_name of reachable) {
    for (const child of complex_types.get(type_name) ?? []) {
      const t = global_elements.get(child.ref);
      if (t) used_elements.set(child.ref, t);
    }
  }

  const sorted_types = [...reachable].sort();
  const sorted_elements = [...used_elements.keys()].sort();

  const lines = [];
  lines.push('/**');
  lines.push(' * Modelo de contenido UBL 2.1 — GENERADO, NO EDITAR A MANO.');
  lines.push(' *');
  lines.push(' * Origen: `../schemas/{common,maindoc}/*.xsd`, copia literal de la Caja de');
  lines.push(' * Herramientas de la DIAN (Validación Previa, versión 1.8).');
  lines.push(' * Regenerar con: `node scripts/generate-dian-ubl-content-model.js`');
  lines.push(' *');
  lines.push(' * Se compila a TypeScript en vez de leer los `.xsd` en runtime porque la');
  lines.push(' * imagen de producción sólo transporta `dist/`: un `.xsd` bajo `src/` no');
  lines.push(' * llega al contenedor y `readFileSync` fallaría con ENOENT la primera vez que');
  lines.push(' * alguien facture. Ver `../schemas/README.md`.');
  lines.push(' *');
  lines.push(` * Tipos: ${sorted_types.length} · Elementos: ${sorted_elements.length}`);
  lines.push(' */');
  lines.push('');
  lines.push('/** Un hijo dentro de la secuencia de un tipo complejo. */');
  lines.push('export interface UblChild {');
  lines.push('  /** QName tal como aparece en el XML: `cbc:ID`, `cac:TaxTotal`. */');
  lines.push('  readonly ref: string;');
  lines.push('  readonly min: number;');
  lines.push('  /** `-1` ≡ `unbounded` (JSON no transporta `Infinity`). */');
  lines.push('  readonly max: number;');
  lines.push('}');
  lines.push('');
  lines.push('/** Secuencia ordenada de hijos por nombre de tipo complejo. */');
  lines.push(
    'export const UBL_CONTENT_MODEL: Readonly<Record<string, readonly UblChild[]>> = {',
  );
  for (const type_name of sorted_types) {
    const children = complex_types.get(type_name);
    lines.push(`  ${JSON.stringify(type_name)}: [`);
    for (const c of children) {
      const max = c.max === Infinity ? -1 : c.max;
      lines.push(
        `    { ref: ${JSON.stringify(c.ref)}, min: ${c.min}, max: ${max} },`,
      );
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push('/** QName de elemento global → nombre de su tipo complejo o simple. */');
  lines.push(
    'export const UBL_ELEMENT_TYPES: Readonly<Record<string, string>> = {',
  );
  for (const qname of sorted_elements) {
    lines.push(
      `  ${JSON.stringify(qname)}: ${JSON.stringify(used_elements.get(qname))},`,
    );
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Nombre del elemento raíz → su tipo. */');
  lines.push(
    'export const UBL_ROOT_TYPES: Readonly<Record<string, string>> = {',
  );
  for (const r of roots.sort((a, b) => a.element.localeCompare(b.element))) {
    lines.push(`  ${JSON.stringify(r.element)}: ${JSON.stringify(r.type)},`);
  }
  lines.push('};');
  lines.push('');

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');

  process.stdout.write(
    `dian-ubl-content-model.ts: ${sorted_types.length} tipos, ` +
      `${sorted_elements.length} elementos, ${roots.length} raíces\n`,
  );
}

main();
