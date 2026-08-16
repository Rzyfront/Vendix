import { normalizeNit } from '../utils/nit.util';
import { isVatResponsible } from './vat-responsibility.helper';
import type { dian_nit_type_enum } from '@prisma/client';

/**
 * Traduce `settings.fiscal_data` (vocabulario de formulario) a las columnas
 * reales de `organizations` y `stores` (vocabulario DIAN).
 *
 * Son DOS vocabularios distintos para los mismos conceptos, y copiarlos tal cual
 * es un bug silencioso: el emisor lee las columnas para armar
 * `cac:AccountingCustomerParty`, así que un `'JURIDICA'` guardado donde la DIAN
 * espera `'1'` produce un XML que se rechaza sin explicar por qué.
 *
 *   fiscal_data (JSON)              organizations (columna)
 *   ─────────────────────────────   ───────────────────────────────────────
 *   nit_type: 'NIT' | 'CC' | ...    document_type: '31' | '13' | ...
 *   person_type: 'JURIDICA'         person_type: '1'  (cbc:AdditionalAccountID)
 *   tax_responsibilities: ['O-48']  tax_regime: '48'  (PartyTaxScheme)
 *                                   fiscal_responsibilities: ['O-48'] (copia)
 *
 * Las columnas de `stores` son DISTINTAS de las de `organizations` (nombres y
 * alcance). Una tienda tiene `nit_type`, `tax_id_dv` y `municipality_code`; la
 * organización consolida con `document_type`, `verification_digit` y NO tiene
 * `municipality_code` (el ICA se declara por tienda). El dispatcher
 * `buildTenantFiscalColumns` enruta según el alcance para que los tres
 * escritores de `fiscal_data` produzcan el mismo estado por el mismo payload.
 *
 * Semántica PATCH: solo se devuelve una columna cuando el campo que la alimenta
 * viene en el patch. Un PATCH que solo trae `legal_name` no debe borrar el NIT.
 */

/** DIAN, tipos de documento de identificación (anexo técnico, tabla 13.2.1). */
export const DIAN_DOCUMENT_TYPE_BY_NIT_TYPE: Record<string, string> = {
  NIT: '31',
  CC: '13',
  CE: '22',
  TI: '12',
  PP: '41',
  NIT_EXTRANJERIA: '50',
};

/** `cbc:AdditionalAccountID`: 1 = Persona Jurídica, 2 = Persona Natural. */
export const DIAN_PERSON_TYPE_BY_LABEL: Record<string, string> = {
  JURIDICA: '1',
  NATURAL: '2',
};

/** Código DIAN del NIT — el único tipo de documento que lleva DV. */
const DIAN_DOCUMENT_TYPE_NIT = '31';

/** Alcance fiscal de un tenant. Define qué tabla de columnas se proyecta. */
export type FiscalScope = 'organization' | 'store';

/**
 * Columnas fiscales de `organizations` (consolidado).
 *
 * NOTA: una organización NO tiene `municipality_code` ni `tax_id_dv` —
 * `verification_digit` es la columna equivalente, y el ICA siempre se declara
 * por tienda.
 */
export interface OrganizationFiscalColumns {
  legal_name?: string | null;
  tax_id?: string | null;
  verification_digit?: string | null;
  document_type?: string | null;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
}

/**
 * Columnas fiscales de `stores` (per-tienda).
 *
 * Distinto de `organizations`: usa `nit_type`/`tax_id_dv` en vez de
 * `document_type`/`verification_digit`, y SÍ tiene `municipality_code`.
 *
 * `nit_type` está tipado como enum Prisma (`dian_nit_type_enum`) en vez de
 * `string` para que Prisma acepte el `UpdateInput` sin cast manual. Si la
 * columna acepta un valor fuera del enum, preferimos fallar en validación que
 * propagar basura al `UpdateInput`.
 */
export interface StoreFiscalColumns {
  legal_name?: string | null;
  tax_id?: string | null;
  tax_id_dv?: string | null;
  nit_type?: dian_nit_type_enum | null;
  municipality_code?: string | null;
  ciiu_code?: string | null;
  // `fiscal_responsibilities` y `tax_regime` viven SOLO en `fiscal_data` (JSON
  // dentro de `store_settings.settings`). NO son columnas de la tabla `stores`
  // — sólo existen en `organizations`/`users`/`suppliers`. Antes este tipo las
  // listaba y la función los emitía, y `tx.stores.update({ data })` reventaba
  // con "Unknown argument `fiscal_responsibilities`" / `tax_regime`, que el
  // AllExceptionsFilter traducía en 500 SYS_INTERNAL_001 (ver QUI-681).
}

/** Lee una clave del patch solo si viene presente y es string; si no, undefined. */
function readTrimmed(
  patch: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in patch)) return undefined;
  const value = patch[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

/** Primera clave presente con valor string. Soporta alias (`tax_id` / `nit`). */
function readFirst(
  patch: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = readTrimmed(patch, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Fusión SUPERFICIAL del payload PATCH sobre el `fiscal_data` previo.
 *
 * Por decisión explícita (no por omisión) es superficial: `tax_responsibilities`
 * es un array, y una fusión profunda lo concatenaría en vez de reemplazarlo.
 * Enviar `['O-13']` para corregir un `['O-13','O-48']` erróneo dejaría las dos
 * responsabilidades si la fusión fuera profunda.
 *
 * Esta función centraliza la fusión para que los tres escritores de
 * `fiscal_data` (`organization/settings` ramas org/tienda, `store/settings`)
 * fundan idéntico. Las llamadas que decían "deep-merge" en el código eran
 * incorrectas en intención y se corregían por accidente al pasar por
 * `{...previous, ...dto}`.
 *
 * ## `undefined` NO borra
 *
 * Un `{...existing, ...patch}` a secas SÍ pisa: una clave presente con valor
 * `undefined` gana sobre el valor guardado y desaparece al serializar el JSON.
 * Eso convierte «el formulario no traía este campo» en «bórralo», que es lo
 * contrario de lo que promete un PATCH.
 *
 * Importa de verdad desde que los DTO de identidad fiscal normalizan el «no
 * seleccionado» de un `<select>` (cadena vacía) a `undefined` para que
 * `@IsOptional()` se lo salte: sin este filtro, guardar el municipio y el CIIU
 * borraba en silencio la periodicidad de IVA declarada, y con ella cambiaba qué
 * declaraciones genera `FiscalObligationService`.
 *
 * Para BORRAR un campo se manda `null` explícito: eso sí atraviesa la fusión.
 */
export function mergeFiscalData<T extends Record<string, unknown>>(
  existing: T,
  patch: Record<string, unknown>,
): T {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...existing, ...defined } as T;
}

/**
 * @param patch Campos que llegaron en el PATCH (ya sin `store_id`).
 * @param merged `fiscal_data` resultante tras el merge — necesario porque
 *   `tax_regime` depende de `tax_responsibilities`, que puede venir de un PATCH
 *   anterior y no del actual.
 */
export function buildOrganizationFiscalColumns(
  patch: Record<string, unknown>,
  merged: { tax_responsibilities?: unknown; tax_regime?: unknown },
): OrganizationFiscalColumns {
  const columns: OrganizationFiscalColumns = {};

  const legalName = readTrimmed(patch, 'legal_name');
  if (legalName !== undefined) columns.legal_name = legalName || null;

  const ciiuCode = readTrimmed(patch, 'ciiu_code');
  if (ciiuCode !== undefined) columns.ciiu_code = ciiuCode || null;

  const nitType = readTrimmed(patch, 'nit_type');
  if (nitType !== undefined) {
    // Un tipo desconocido se guarda como null en vez de propagarse crudo: es
    // preferible una columna vacía a un código que la DIAN no reconoce.
    columns.document_type = DIAN_DOCUMENT_TYPE_BY_NIT_TYPE[nitType] ?? null;
  }

  const personType = readTrimmed(patch, 'person_type');
  if (personType !== undefined) {
    columns.person_type =
      DIAN_PERSON_TYPE_BY_LABEL[personType.toUpperCase()] ?? null;
  }

  const rawTaxId = readFirst(patch, ['tax_id', 'nit']);
  if (rawTaxId !== undefined) {
    const documentType =
      columns.document_type !== undefined
        ? columns.document_type
        : DIAN_DOCUMENT_TYPE_NIT;

    if (documentType === DIAN_DOCUMENT_TYPE_NIT) {
      // `normalizeNit` y no `computeNitDv` a secas: la gente escribe el NIT con
      // su DV pegado (`902056589-9`), y `computeNitDv` sobre esa cadena calcula
      // el módulo 11 incluyendo el propio DV como dígito — devuelve '1' donde
      // corresponde '9'. `normalizeNit` parte por el guion y deriva desde la
      // cabecera. La columna guarda el número SIN DV; el DV vive aparte y el
      // emisor los une.
      const { number, dv } = normalizeNit(rawTaxId);
      columns.tax_id = number || null;
      columns.verification_digit = number ? dv || null : null;
    } else {
      // Documentos que no son NIT no llevan DV, y pueden traer letras (NIT
      // extranjero), así que no se les aplica el saneado de dígitos.
      columns.tax_id = rawTaxId || null;
      columns.verification_digit = null;
    }
  }

  if ('tax_responsibilities' in patch) {
    const responsibilities = Array.isArray(patch.tax_responsibilities)
      ? (patch.tax_responsibilities as unknown[]).filter(
          (code): code is string => typeof code === 'string',
        )
      : [];
    columns.fiscal_responsibilities = responsibilities;
  }

  // `tax_regime` en columna es '48'/'49' (responsable o no de IVA), NO el
  // régimen COMUN/SIMPLIFICADO del formulario. Se resuelve con el mismo helper
  // canónico que usan productos y ventas, para que no existan dos verdades.
  if ('tax_responsibilities' in patch || 'tax_regime' in patch) {
    columns.tax_regime = isVatResponsible(merged) ? '48' : '49';
  }

  return columns;
}

/**
 * Proyecta las columnas fiscales de `stores` desde el patch + fiscal_data
 * fusionado. Espejo de `buildOrganizationFiscalColumns` con los nombres de
 * columna propios de la tabla `stores` (no hay `document_type` ni
 * `verification_digit`; sí hay `municipality_code` y `tax_id_dv`).
 */
export function buildStoreFiscalColumns(
  patch: Record<string, unknown>,
  merged: { tax_responsibilities?: unknown; tax_regime?: unknown },
): StoreFiscalColumns {
  const columns: StoreFiscalColumns = {};

  const legalName = readTrimmed(patch, 'legal_name');
  if (legalName !== undefined) columns.legal_name = legalName || null;

  const ciiuCode = readTrimmed(patch, 'ciiu_code');
  if (ciiuCode !== undefined) columns.ciiu_code = ciiuCode || null;

  const municipalityCode = readTrimmed(patch, 'municipality_code');
  if (municipalityCode !== undefined) {
    columns.municipality_code = municipalityCode || null;
  }

  const nitType = readTrimmed(patch, 'nit_type');
  if (nitType !== undefined) {
    columns.nit_type = (nitType || null) as dian_nit_type_enum | null;
  }

  const rawTaxId = readFirst(patch, ['tax_id', 'nit']);
  if (rawTaxId !== undefined) {
    const isNit = nitType === undefined || nitType === 'NIT';
    if (isNit) {
      // Ver bloque de documentación de `buildOrganizationFiscalColumns` sobre
      // por qué `normalizeNit` y no `computeNitDv` a secas.
      const { number, dv } = normalizeNit(rawTaxId);
      columns.tax_id = number || null;
      columns.tax_id_dv = number ? dv || null : null;
    } else {
      columns.tax_id = rawTaxId || null;
      columns.tax_id_dv = null;
    }
  }

  // `tax_responsibilities` y `tax_regime` NO se proyectan a columnas porque la
  // tabla `stores` no las tiene (viven sólo en `organizations`/`users`/
  // `suppliers`). La rama que las emitía fue la causa del 500 de QUI-681 al
  // hacer `tx.stores.update({ data })` con `fiscal_responsibilities`/`tax_regime`
  // — Prisma 7 rechaza argumentos desconocidos y el AllExceptionsFilter lo
  // convertía en 500 SYS_INTERNAL_001. Los datos siguen llegando a
  // `fiscal_data` por la vía del upsert de `store_settings.settings`.

  return columns;
}

/**
 * Proyector único por alcance fiscal. Despacha al projector del alcance pedido
 * para que los tres escritores de `fiscal_data` produzcan el mismo estado por el
 * mismo payload (organización vs tienda son tablas con columnas distintas).
 *
 * El parámetro `merged` es el `fiscal_data` ya fusionado con el existente —
 * NUNCA solo el patch — porque una escritura parcial no debe dejar columnas a
 * medias (ej: el patch trae `tax_regime` pero las responsabilidades vienen del
 * estado previo).
 *
 * Implementado como overload para que el tipo de retorno se refine según el
 * scope: `organization` → `OrganizationFiscalColumns`, `store` →
 * `StoreFiscalColumns`. Esto permite que Prisma infiera el `UpdateInput` de la
 * tabla correcta sin cast manual en el sitio de uso.
 */
export function buildTenantFiscalColumns(
  scope: 'organization',
  patch: Record<string, unknown>,
  merged: Record<string, unknown>,
): OrganizationFiscalColumns;
export function buildTenantFiscalColumns(
  scope: 'store',
  patch: Record<string, unknown>,
  merged: Record<string, unknown>,
): StoreFiscalColumns;
export function buildTenantFiscalColumns(
  scope: FiscalScope,
  patch: Record<string, unknown>,
  merged: Record<string, unknown>,
): OrganizationFiscalColumns | StoreFiscalColumns {
  if (scope === 'organization') {
    return buildOrganizationFiscalColumns(patch, merged);
  }
  return buildStoreFiscalColumns(patch, merged);
}
