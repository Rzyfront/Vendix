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
 *    derivar el DV, unir la línea de dirección y etiquetar el régimen. Esta
 *    función es ese mismo contrato, fiel línea a línea, reubicado donde lo
 *    consumen las DOS superficies de impresión (HTML del gateway y PDF bajo
 *    demanda). Si `resolveIssuer` cambia de precedencias, esta debe cambiar
 *    con él — la spec de paridad numérica (E.11) es la compuerta que detecta
 *    la divergencia.
 */
import {
  resolveTenantFiscalIdentity,
  tryResolveTenantFiscalIdentity,
} from '@common/helpers/fiscal-identity.helper';
import { isVatResponsible } from '@common/helpers/vat-responsibility.helper';

/** Etiquetas legibles del régimen guardado en `fiscal_data.tax_regime`. */
export const FISCAL_TAX_REGIME_LABELS: Record<string, string> = {
  COMUN: 'Responsable de IVA',
  SIMPLIFICADO: 'No responsable de IVA',
  SIMPLE: 'Regimen Simple de Tributacion (RST)',
  GRAN_CONTRIBUYENTE: 'Gran contribuyente',
  NO_RESPONSABLE: 'No responsable de IVA',
};

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
  /** Régimen ya etiquetado, o el valor crudo si no hay etiqueta. */
  tax_regime?: string;
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
    tax_regime: (() => {
      const isResponsible = isVatResponsible(identity);
      const rawRegime = (identity.tax_regime || '').toUpperCase();
      if (
        identity.tax_responsibilities.includes('O-47') ||
        rawRegime === 'SIMPLE'
      ) {
        return FISCAL_TAX_REGIME_LABELS.SIMPLE;
      }
      if (
        identity.tax_responsibilities.includes('O-13') ||
        rawRegime === 'GRAN_CONTRIBUYENTE'
      ) {
        return FISCAL_TAX_REGIME_LABELS.GRAN_CONTRIBUYENTE;
      }
      if (isResponsible) {
        return FISCAL_TAX_REGIME_LABELS.COMUN;
      }
      return FISCAL_TAX_REGIME_LABELS.SIMPLIFICADO;
    })(),
    tax_responsibilities: identity.tax_responsibilities,
  };
}
