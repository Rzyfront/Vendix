/**
 * [print-editor-dsk] — Normalización perezosa de `PrintFormatDefinition`.
 *
 * Skill: vendix-validation, vendix-naming-conventions.
 *
 * El frontend históricamente escribió 8 campos en camelCase
 * (`heightMm`, `marginTopMm`, `marginRightMm`, `marginBottomMm`,
 * `marginLeftMm`, `sizeMm`, `customLabel`, `companyBlock`) mientras el
 * contrato TS (`PrintFormatDefinition` en `../interfaces/print-format.interface.ts`)
 * y el schema AJV (`definition-v2.schema.json`) siempre esperaron la forma
 * snake_case (`height_mm`, `margin_top_mm`, ..., `custom_label`,
 * `company_block`). Con la compuerta `shouldValidateV2Payload()` nunca
 * disparando (ningún escritor emitía `v: 2`), AJV jamás corría y
 * `additionalProperties: false` nunca rechazaba el nombre equivocado — el
 * campo camelCase simplemente se guardaba tal cual y el compositor
 * (que solo lee las claves snake_case) lo ignoraba en silencio.
 *
 * `normalizeDefinition()` cierra esa brecha ANTES de validar: reescribe los
 * 8 alias a su forma canónica para que (a) AJV valide la forma que el
 * compositor realmente lee, y (b) un payload legítimo escrito por el
 * frontend viejo no se rechace solo por usar el nombre viejo.
 *
 * Deliberadamente NO es una conversión genérica camelCase→snake_case — eso
 * rompería claves que deben permanecer intactas: `custom_template`, `token`
 * (ya snake_case, pero con un solo componente por lo que una conversión
 * genérica por regex podría tocarlas de forma inesperada) y las claves
 * LIBRES dentro de `styles.theme_tokens` / `styles` en general, que son
 * datos de usuario (nombres de variables CSS, etc.) y no deben normalizarse
 * nunca. La tabla explícita (`CAMEL_TO_SNAKE_ALIASES`) es la única fuente
 * de verdad de qué se reescribe.
 */

/**
 * Los 8 alias camelCase → snake_case que el frontend legado escribió.
 * Única fuente de verdad: NO se deriva por regex de un caso genérico.
 */
export const CAMEL_TO_SNAKE_ALIASES = {
  heightMm: 'height_mm',
  marginTopMm: 'margin_top_mm',
  marginRightMm: 'margin_right_mm',
  marginBottomMm: 'margin_bottom_mm',
  marginLeftMm: 'margin_left_mm',
  sizeMm: 'size_mm',
  customLabel: 'custom_label',
  companyBlock: 'company_block',
} as const;

type CamelAliasKey = keyof typeof CAMEL_TO_SNAKE_ALIASES;

const CAMEL_ALIAS_KEYS = Object.keys(CAMEL_TO_SNAKE_ALIASES) as CamelAliasKey[];

/**
 * [print-editor-dsk] — Versión de schema que `normalizeDefinition()` estampa
 * cuando el payload no trae `v`.
 *
 * Medido en la base de datos de desarrollo: 16 de 17 `print_templates.definition`
 * NO tienen la clave `v` — son definiciones v1 legítimas ya guardadas, no
 * payloads corruptos. Estampar `v: 2` en ausencia (nunca sobreescribir un
 * `v` explícito) es darles la versión de schema actual para que puedan
 * validar contra `definition-v2.schema.json`, no rechazarlas. Rechazarlas
 * habría convertido el módulo entero en inguardable — vía la validación
 * incondicional de `PrintFormatsService`, cada plantilla de sistema
 * existente habría respondido 422 solo por carecer de un campo que nadie
 * les pidió nunca escribir.
 */
const CURRENT_DEFINITION_VERSION = 2;

/**
 * Reescribe, en un único nivel de objeto, los alias camelCase presentes a
 * su forma snake_case. Pura: siempre devuelve un objeto NUEVO, nunca muta
 * `obj`. Si ambas formas están presentes, la snake_case (canónica) gana y
 * la camelCase se descarta.
 *
 * Valores no-objeto (`null`, arrays, primitivos) se devuelven tal cual —
 * esto permite llamar la función de forma defensiva sobre campos opcionales
 * sin verificar su forma antes.
 */
function applyAliases(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };

  for (const camelKey of CAMEL_ALIAS_KEYS) {
    if (!(camelKey in source)) continue;
    const snakeKey = CAMEL_TO_SNAKE_ALIASES[camelKey];
    if (!(snakeKey in source)) {
      // Solo la forma camelCase está presente: se promueve a snake_case.
      result[snakeKey] = source[camelKey];
    }
    // Si AMBAS formas están presentes, la snake_case (ya copiada por el
    // spread de arriba) gana; la camelCase se descarta en cualquier caso.
    delete result[camelKey];
  }

  return result;
}

/**
 * Normaliza una `PrintFormatDefinition` cruda (v1 legado o v2 con alias
 * camelCase) a su forma snake_case canónica, aplicando los alias en los
 * cinco sitios donde pueden aparecer:
 *
 *  - raíz (`companyBlock` → `company_block`)
 *  - `paper` (`heightMm`, `marginTopMm`, `marginRightMm`, `marginBottomMm`,
 *    `marginLeftMm`)
 *  - `logo` (`sizeMm`)
 *  - `company_block.fields[]` (`customLabel`)
 *  - cada `sections[].fields[]` (`customLabel`)
 *
 * También estampa `v: 2` cuando la clave está ausente (ver
 * `CURRENT_DEFINITION_VERSION` arriba) — NUNCA sobreescribe un `v` explícito
 * ya presente.
 *
 * Pura: no muta `payload` ni ningún objeto/array anidado. Entradas que no
 * son un objeto plano (`null`, `undefined`, arrays, primitivos) se
 * devuelven tal cual — el llamador (`PrintFormatsService`) es responsable
 * de tratar `overrides` vacío/nulo como no-op ANTES de invocar esta
 * función, no aquí.
 *
 * NO toca `custom_template`, `tokens`/`token`, ni ninguna clave dentro de
 * `styles` — esos campos ni siquiera se visitan, se copian por referencia
 * desde el objeto raíz.
 */
export function normalizeDefinition(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const src = payload as Record<string, any>;

  // Raíz: promueve `companyBlock` → `company_block` (y cualquier otro alias
  // que, por error, apareciera a este nivel). `custom_template`, `tokens`,
  // `styles`, `columns` quedan copiados tal cual por el spread interno de
  // `applyAliases` — nunca se recorren.
  const root = applyAliases(src) as Record<string, any>;

  // Estampado de versión — solo en ausencia, ver doc de
  // `CURRENT_DEFINITION_VERSION`.
  if (root.v === undefined || root.v === null) {
    root.v = CURRENT_DEFINITION_VERSION;
  }

  if (src.paper && typeof src.paper === 'object' && !Array.isArray(src.paper)) {
    root.paper = applyAliases(src.paper);
  }

  if (src.logo && typeof src.logo === 'object' && !Array.isArray(src.logo)) {
    root.logo = applyAliases(src.logo);
  }

  // `root.company_block` ya refleja la promoción de `companyBlock` hecha
  // arriba (si existía) — se lee de `root`, no de `src`, para cubrir ambos
  // orígenes con una sola rama.
  const companyBlock = root.company_block;
  if (
    companyBlock &&
    typeof companyBlock === 'object' &&
    !Array.isArray(companyBlock) &&
    Array.isArray((companyBlock as Record<string, any>).fields)
  ) {
    root.company_block = {
      ...companyBlock,
      fields: (companyBlock as Record<string, any>).fields.map((field: unknown) => applyAliases(field)),
    };
  }

  if (Array.isArray(src.sections)) {
    root.sections = src.sections.map((section: any) => {
      if (!section || typeof section !== 'object' || !Array.isArray(section.fields)) {
        return section;
      }
      return {
        ...section,
        fields: section.fields.map((field: unknown) => applyAliases(field)),
      };
    });
  }

  return root;
}
