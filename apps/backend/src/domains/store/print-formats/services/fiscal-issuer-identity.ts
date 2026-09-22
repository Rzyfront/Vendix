/**
 * Identidad fiscal DEL EMISOR proyectada para IMPRIMIR.
 *
 * E.11 casilla 1 — el mapeador fiscal imprimía `organizations.tax_id` crudo,
 * así que bajo `fiscal_scope = 'STORE'` el NIT del papel podía discrepar del
 * XML firmado (la identidad real vive en `store_settings.settings.fiscal_data`).
 * La corrección pasa por el RESOLVEDOR ÚNICO
 * (`resolveTenantFiscalIdentity`, `@common/helpers/fiscal-identity.helper`) y
 * NO por una re-implementation local de la precedencia.
 *
 * Por qué este archivo existe en vez de inyectar `InvoicePdfService`:
 *
 * 1. El resolvedor ya es un helper de `common/` — importarlo no crea ninguna
 *    dependencia cruzada de módulos Nest; no hubo que exportar nada nuevo de
 *    invoicing.
 * 2. Lo que sí vivía dentro de invoicing era la PREPARACIÓN de la fuente
 *    (`InvoicePdfService.resolveIssuer`, `invoice-pdf.service.ts:537-613`):
 *    elegir settings según `fiscal_scope`, armar el `FiscalIdentitySource`,
 *    derivar el DV y unir la línea de dirección. Esta función es ese mismo
 *    contrato, reubicado donde lo consumen las DOS superficies de impresión
 *    (HTML del gateway y PDF bajo demanda). Si `resolveIssuer` cambia de
 *    precedencias, esta debe cambiar con él — la spec de paridad numérica
 *    (E.11) es la compuerta que detecta la divergencia.
 * 3. Desde 2026-09 este archivo es además el DUEÑO ÚNICO del renglón de
 *    calidades fiscales (`resolveFiscalQualitiesLine`). Antes la misma etiqueta
 *    se calculaba en tres sitios divergentes —aquí, en `invoice-pdf.service.ts`
 *    y en los `pos-ticket.service.ts` de web y mobile— y ya habían derivado
 *    hacia respuestas distintas para el mismo tenant. `invoice-pdf.service.ts`
 *    consume ESTA función; web y mobile la replican bajo sus propias specs
 *    porque `mobile-dev` RULE 4 prohíbe el import cruzado entre apps.
 */
import {
  resolveTenantFiscalIdentity,
  tryResolveTenantFiscalIdentity,
} from '@common/helpers/fiscal-identity.helper';
import { normalizeFiscalResponsibilityCode } from '@common/constants/fiscal-responsibilities';

/**
 * CALIDADES FISCALES IMPRIMIBLES — fuente ÚNICA para toda superficie de papel.
 *
 * Num. 12 del art. 11 de la Resolución DIAN 000165 de 2023 (reiterado por la
 * Res. 000227 de 2025, art. 1.5.1.2.2.1) enumera EXACTAMENTE cuatro calidades
 * que la representación gráfica indica «cuando corresponda». No hay una quinta,
 * y ninguna de ellas es «Responsable de IVA» / «No responsable de IVA».
 *
 * La leyenda de régimen que este archivo imprimía antes era herencia del
 * art. 506 del E.T., DEROGADO por la Ley 1943 de 2018 (art. 122) y por la
 * Ley 2010 de 2019 (art. 160). Ya no tiene base legal: el art. 617 lit. i) del
 * E.T. sólo exige indicar la calidad de RETENEDOR. Un restaurante responsable
 * únicamente de INC salía con «Responsable de IVA» en la cabecera — una
 * obligación que no tiene, declarada en un documento con valor probatorio.
 *
 * Además, el anexo técnico FEV 1.9 §5.8 exige que «la información presentada en
 * la representación gráfica de los documentos electrónicos debe estar en el
 * XML». Las cuatro calidades salen de `tax_responsibilities`, que es justo lo
 * que el XML declara en `cac:TaxScheme/cbc:TaxLevelCode`; una leyenda de régimen
 * que el XML no contiene es incumplimiento.
 *
 * Por eso la leyenda se ELIMINA, no se reemplaza: si el emisor no tiene ninguna
 * de las cuatro calidades, el renglón NO se imprime.
 *
 * El orden es el del num. 12 y es estable a propósito: dos emisores con las
 * mismas calidades imprimen la misma cadena, y la spec puede fijarla.
 */
export const PRINTABLE_FISCAL_QUALITIES: ReadonlyArray<{
  code: string;
  label: string;
}> = [
  { code: 'O-23', label: 'Agente retenedor del Impuesto sobre las Ventas (IVA)' },
  {
    code: 'O-15',
    label: 'Autorretenedor del Impuesto sobre la Renta y Complementarios',
  },
  { code: 'O-13', label: 'Gran contribuyente' },
  {
    code: 'O-47',
    label: 'Contribuyente del Régimen Simple de Tributación (SIMPLE)',
  },
];

/** Separador del renglón cuando concurren varias calidades. */
export const FISCAL_QUALITIES_SEPARATOR = ' | ';

/**
 * Calidades del num. 12 que corresponden a este emisor, ya etiquetadas.
 *
 * Normaliza cada código antes de comparar: `fiscal_data.tax_responsibilities`
 * guarda lo que el tenant cargó —la casilla 53 cruda (`'13'`, `'5'`) o el código
 * canónico (`'O-13'`)— y `resolveTenantFiscalIdentity` NO normaliza. Comparar
 * sin normalizar hacía que un gran contribuyente que guardó `'13'` no imprimiera
 * su calidad.
 */
export function resolvePrintableFiscalQualities(
  tax_responsibilities: readonly string[] | null | undefined,
): string[] {
  const codes = new Set(
    (tax_responsibilities ?? [])
      .filter((code): code is string => typeof code === 'string')
      .map((code) => normalizeFiscalResponsibilityCode(code))
      .filter(Boolean),
  );
  return PRINTABLE_FISCAL_QUALITIES.filter((q) => codes.has(q.code)).map(
    (q) => q.label,
  );
}

/**
 * El renglón listo para pintar, o `undefined` cuando NINGUNA calidad aplica.
 *
 * `undefined` —y no `''`— porque toda superficie de impresión ya omite el campo
 * ausente: devolver cadena vacía dejaba un renglón en blanco en el papel.
 */
export function resolveFiscalQualitiesLine(
  tax_responsibilities: readonly string[] | null | undefined,
): string | undefined {
  const qualities = resolvePrintableFiscalQualities(tax_responsibilities);
  return qualities.length
    ? qualities.join(FISCAL_QUALITIES_SEPARATOR)
    : undefined;
}

/** Identidad del emisor lista para pintarse en cualquier superficie. */
export interface FiscalIssuerPrintIdentity {
  /** Razón social RUT — la que firmó el XML. */
  legal_name: string;
  /**
   * NIT para mostrar: número normalizado + DV DERIVADO por módulo 11, nunca el
   * dígito almacenado (`fiscal-identity.helper.ts`: «un DV almacenado que
   * discrepe del módulo 11 es por definición incorrecto»). `'N/A'` si no hay
   * NIT resoluble — igual que `resolveIssuer`.
   */
  nit_display: string;
  /** Nombre comercial: el del dueño del alcance (tienda u organización). */
  trade_name?: string;
  /** Dirección fiscal RUT, sin ciudad. */
  fiscal_address: string;
  city: string;
  department: string;
  /** Línea de dirección compuesta como la imprime el builder PDF. */
  address_line?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  /**
   * Renglón de calidades fiscales del num. 12 (art. 11 Res. 000165/2023), ya
   * etiquetado. `undefined` cuando el emisor no ostenta ninguna — en ese caso
   * el renglón NO se imprime. Sustituye al antiguo `tax_regime`, que declaraba
   * una obligación («Responsable de IVA») sin base legal desde la derogatoria
   * del art. 506 E.T.
   */
  fiscal_qualities?: string;
  tax_responsibilities: string[];
}

/**
 * Resuelve la identidad del emisor con el resolvedor único.
 *
 * `strict` replica la asimetría lectura/emisión de `invoice-pdf.service.ts`:
 * documento electrónico (`dian_status !== 'not_applicable'`) → estricto, lanza
 * `FISCAL_IDENTITY_INCOMPLETE` (422) antes de imprimir un dato fabricado — el
 * PDF legal YA falla hoy en ese caso por `generatePdf`, así que el HTML deja de
 * imprimir un papel divergente y falla IGUAL. Recibo interno o borrador →
 * permisivo: sin XML con qué cuadrar, negar la impresión no protege nada.
 */
export function resolveFiscalIssuerForPrint(
  org: any,
  store: any,
  strict: boolean,
): FiscalIssuerPrintIdentity {
  const scope: string = org?.fiscal_scope ?? 'STORE';
  const scoped_settings =
    scope === 'STORE'
      ? store?.store_settings?.settings
      : org?.organization_settings?.settings;
  // `settings` is a Prisma Json column, untyped at runtime.
  const fiscal = ((scoped_settings as any)?.fiscal_data ?? null) as
    | Record<string, unknown>
    | null;

  const owner = scope === 'STORE' ? store : org;
  const address = owner?.addresses?.[0] ?? org?.addresses?.[0];

  // Misma fuente que `InvoicePdfService.resolveIssuer`: el resolvedor decide
  // las precedencias; aquí sólo se le alimenta con lo que la fila trae. Los
  // campos del objeto `organization` son EXACTAMENTE los que pasa
  // `resolveIssuer` — añadir aquí un respaldo que allá no existe (p.ej.
  // `fiscal_responsibilities` de columna) fabricaría una identidad distinta
  // según la superficie que imprime.
  const source = {
    nit: org?.tax_id || store?.tax_id || '',
    fiscal_data: fiscal,
    entity: null,
    organization: org
      ? {
          legal_name: org.legal_name,
          name: org.name,
          email: org.email,
          phone: org.phone,
          document_type: org.document_type,
          person_type: org.person_type,
        }
      : null,
    address: address
      ? {
          address_line1: address.address_line1,
          city: address.city,
          state_province: address.state_province,
          municipality_code: address.municipality_code,
          postal_code: address.postal_code,
          phone_number: address.phone_number,
        }
      : null,
    email: org?.email,
  };

  const identity = strict
    ? resolveTenantFiscalIdentity(source)
    : tryResolveTenantFiscalIdentity(source).identity;

  const address_line =
    identity.fiscal_address && (identity.city || identity.department)
      ? [identity.fiscal_address, identity.city, identity.department]
          .filter(Boolean)
          .join(', ')
      : identity.fiscal_address || undefined;

  const nit_display = identity.nit
    ? identity.nit_dv
      ? `${identity.nit}-${identity.nit_dv}`
      : identity.nit
    : 'N/A';

  return {
    legal_name: identity.legal_name,
    nit_display,
    trade_name: owner?.name || undefined,
    fiscal_address: identity.fiscal_address,
    city: identity.city,
    department: identity.department,
    address_line,
    phone: identity.phone,
    email: identity.email || org?.email || undefined,
    logo_url: store?.logo_url || org?.logo_url || undefined,
    fiscal_qualities: resolveFiscalQualitiesLine(identity.tax_responsibilities),
    tax_responsibilities: identity.tax_responsibilities,
  };
}
