/**
 * Responsabilidades fiscales ACEPTADAS por `cbc:TaxLevelCode`.
 *
 * Definición ÚNICA de la enumeración. Antes vivía como un `Set` privado dentro
 * de `xml/ubl-common.builder.ts`, invisible para cualquier otra capa; este
 * archivo la saca al catálogo para que exista un solo sitio que la defina y un
 * solo sitio que haya que corregir cuando la DIAN la mueva.
 *
 * =====================================================================
 * LO PRIMERO, PORQUE ES LO QUE PRODUCE EL RECHAZO: SON DOS LISTAS
 * =====================================================================
 * `cbc:TaxLevelCode` NO recibe el catálogo de la casilla 53 del RUT. Son dos
 * listas distintas que comparten el prefijo `O-`, y ahí está la trampa:
 *
 *   - Casilla 53 del RUT → catálogo amplio (`O-13, O-14, O-15, O-16, O-17,
 *     O-19, O-22, O-32, O-33, O-47, O-48, O-49, R-99-PN`, entre otros). Es lo
 *     que Vendix persiste en `settings.fiscal_data.tax_responsibilities` y lo
 *     que define `apps/backend/src/common/constants/fiscal-responsibilities.ts`.
 *   - `cbc:TaxLevelCode` → enumeración CORTA, la de abajo.
 *
 * Una migración escribió las responsabilidades del RUT (`O-05, O-07, O-14,
 * O-42, O-48`) en el campo que alimenta este elemento y la DIAN respondió FAJ26
 * «Responsabilidad informada por emisor no válida según lista». Por eso la
 * conversión NO es un `join(';')`: es un FILTRO contra esta enumeración, con
 * `R-99-PN` como respaldo. Un contribuyente cuyas responsabilidades del RUT no
 * caen en ninguna de estas categorías no declara ninguna — no inventa una.
 *
 * =====================================================================
 * LAS TRES FUENTES, Y POR QUÉ SON CINCO VALORES Y NO TRECE
 * =====================================================================
 * Se contrastaron las tres fuentes disponibles y NINGUNA sostiene una lista
 * larga para este elemento:
 *
 *  1. `Listas de valores/TipoResponsabilidad-2.1.gc` (caja de herramientas
 *     v1.8) — 5 filas: `O-13`, `O-15`, `O-23`, `O-47`, `ZZ`.
 *  2. Anexo Técnico 1.9 (Res. 000165/2023), reglas FAJ26 / FAK26 / CAJ26 /
 *     CAK26 / DAJ26 — no imprime la tabla (§13.2.7.6 la remite a `Tablas
 *     Referenciadas`, carpeta que el ZIP publicado no trae), pero SÍ fija dos
 *     cosas: el ejemplo canónico es «`O-13;O-15`» y «Para consumidor final se
 *     debe informar "R-99-PN"».
 *  3. `Schemes/listacodigos/DIAN_UBL21-listacodigos_v1.6.sch` — generado en
 *     2019, admite 111 valores (`O-06 … E-99`). Es la lista ANTIGUA, anterior a
 *     la v1.8, y es la única que se parece a «13+». No se usa: aceptar de más
 *     aquí no evita ningún rechazo, y emitir uno de esos 111 contra el motor
 *     actual sí lo provoca.
 *
 * DISCREPANCIA v1.8 vs v1.9 — RESUELTA A FAVOR DE LA 1.9. El `.gc` de la v1.8
 * usa `ZZ` como «No aplica»; el anexo 1.9 ordena `R-99-PN` para el consumidor
 * final. Manda `R-99-PN` (fuente más reciente, y además presente también en la
 * lista de 111 de 2019, donde `ZZ` no aparece). `ZZ` NO se acepta: agregar un
 * valor que solo respalda la fuente vieja es exactamente el riesgo que este
 * archivo existe para evitar.
 *
 * SI APARECE `Tablas Referenciadas/13.2.6.1 Responsabilidades fiscales.xlsx`,
 * es la fuente que zanja el asunto — añadir aquí lo que diga y borrar esta nota.
 */

/**
 * Enumeración aceptada por `cbc:TaxLevelCode`, con su significado.
 * Es la definición canónica: cualquier otra capa debe importar de aquí.
 */
export const DIAN_TAX_LEVEL_CODES = {
  /** O-13 — Gran contribuyente. */
  GRAN_CONTRIBUYENTE: 'O-13',
  /** O-15 — Autorretenedor. */
  AUTORRETENEDOR: 'O-15',
  /** O-23 — Agente de retención IVA. */
  AGENTE_RETENCION_IVA: 'O-23',
  /** O-47 — Régimen simple de tributación. */
  REGIMEN_SIMPLE: 'O-47',
  /**
   * R-99-PN — «No aplica / ninguna de las anteriores».
   * Valor obligatorio para el consumidor final (anexo 1.9, notas de FAK26 y
   * CAK26). Es EXCLUYENTE: no se combina con los otros cuatro.
   */
  NO_APLICA: 'R-99-PN',
} as const;

/** Unión de los códigos válidos para `cbc:TaxLevelCode`. */
export type DianTaxLevelCode =
  (typeof DIAN_TAX_LEVEL_CODES)[keyof typeof DIAN_TAX_LEVEL_CODES];

/** Valor «ninguna de las anteriores». Respaldo cuando no sobrevive nada. */
export const DIAN_TAX_LEVEL_CODE_NONE: DianTaxLevelCode =
  DIAN_TAX_LEVEL_CODES.NO_APLICA;

/**
 * Etiquetas en español para UI y trazas de auditoría.
 * Exhaustivo sobre `DianTaxLevelCode`: añadir un código sin su etiqueta es un
 * error de compilación, no un hueco en la interfaz.
 */
export const DIAN_TAX_LEVEL_CODE_LABELS: Readonly<
  Record<DianTaxLevelCode, string>
> = {
  'O-13': 'Gran contribuyente',
  'O-15': 'Autorretenedor',
  'O-23': 'Agente de retención IVA',
  'O-47': 'Régimen simple de tributación',
  'R-99-PN': 'No aplica / ninguna de las anteriores',
};

/** Conjunto de búsqueda. Se construye una vez, no en cada llamada. */
const TAX_LEVEL_CODE_SET: ReadonlySet<string> = new Set<string>(
  Object.values(DIAN_TAX_LEVEL_CODES),
);

/** `true` si el valor es uno de los códigos que `cbc:TaxLevelCode` acepta. */
export function isDianTaxLevelCode(value: unknown): value is DianTaxLevelCode {
  return typeof value === 'string' && TAX_LEVEL_CODE_SET.has(value);
}

/**
 * Convierte responsabilidades del RUT (o cualquier entrada suelta) al valor de
 * `cbc:TaxLevelCode`.
 *
 * Acepta la forma con punto y coma que el anexo permite (`'O-13;O-15'`) y
 * también un arreglo, descarta todo lo que no pertenezca a la enumeración,
 * elimina repetidos conservando el orden, y devuelve `R-99-PN` cuando no queda
 * nada. Nunca propaga un código del RUT que la DIAN rechazaría.
 *
 * Equivale a `UblCommonBuilder.toTaxLevelCode`, que es el llamador que debe
 * migrar a esta función, con UNA diferencia deliberada: aquí se eliminan los
 * repetidos. `'O-13;O-13'` devuelve `'O-13'`, no `'O-13;O-13'`. El anexo pide
 * «separando cada uno de los valores», no repetirlos, y una responsabilidad
 * duplicada solo puede venir de un dato mal guardado. Los casos que cubre la
 * suite existente (`ubl-common.builder.spec.ts`, describe «enumeración cerrada
 * (FAJ26)») dan el mismo resultado con las dos implementaciones.
 */
export function toDianTaxLevelCode(
  value?: string | readonly string[] | null,
): string {
  const raw = Array.isArray(value) ? value.join(';') : String(value ?? '');
  const kept: string[] = [];
  for (const code of raw.split(';')) {
    const trimmed = code.trim();
    if (TAX_LEVEL_CODE_SET.has(trimmed) && !kept.includes(trimmed)) {
      kept.push(trimmed);
    }
  }
  return kept.length ? kept.join(';') : DIAN_TAX_LEVEL_CODE_NONE;
}

/**
 * HUECO CONOCIDO EN EL CATÁLOGO DEL RUT (no se corrige desde aquí).
 *
 * `O-23` (Agente de retención IVA) SÍ está en la enumeración de
 * `cbc:TaxLevelCode`, pero NO está en `FISCAL_RESPONSIBILITIES`
 * (`apps/backend/src/common/constants/fiscal-responsibilities.ts` y su espejo
 * del frontend). Consecuencia práctica: un comerciante que ES agente de
 * retención de IVA no puede marcarlo en la ficha del cliente, así que ese
 * `O-23` nunca llega a `toDianTaxLevelCode` y el documento lo omite.
 *
 * Sí aparece, en cambio, en `FISCAL_RESPONSIBILITIES_CATALOG`
 * (`domains/fiscal-operations/constants/fiscal-responsibilities.catalog.ts`),
 * que es un TERCER catálogo de responsabilidades con 7 entradas y otro contenido.
 * Es decir: hay tres listas de responsabilidades fiscales en el backend y
 * ninguna contiene a las otras. Unificarlas toca archivos fuera del alcance de
 * este catálogo; queda documentado aquí para que el siguiente lector lo vea.
 */
