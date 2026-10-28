import { FullTaxRow } from '../../../orders/utils/catalog-line-pricing.util';
import { TaxFiscalType } from '../../../taxes/dto';
import { HOME_COUNTRY_CODE } from './lodging-guest-rules';

/**
 * Hospitality Suite (H3.9) — VAT exemption of the lodging sold to a
 * non-resident foreign tourist (art. 481 lit. d ET, DUR 1625/2016
 * art. 1.3.1.11.1). The hotel must hold an RNT and keep the passport and the
 * entry stamp/permit of the guest; the nights of the folio are then invoiced
 * with VAT at 0 % ("exento": the tax is reported with `Percent 0.00`, never
 * omitted like an excluded good). Consumptions keep their tax.
 */

/** Tax name of an exempt night line; it reaches the invoice and the report. */
export const VAT_EXEMPTION_TAX_NAME = 'Exento – art. 481 lit. d ET';

/** Entry stamps/permits the DIAN accepts as support (Concepto 011050/2026). */
export const VAT_EXEMPT_ENTRY_PERMITS = [
  'PIP-3',
  'PIP-5',
  'PIP-6',
  'PIP-10',
  'TP-7',
  'TP-11',
  'TP-12',
  'PT',
];

export interface VatExemptionGuest {
  is_primary: boolean;
  document_type: string | null;
  nationality_country_code: string | null;
  entry_permit_type: string | null;
  is_non_resident: boolean;
}

/** "pip 5", "PIP5" or "pip-5" → "PIP-5"; empty → null. */
export function normalizeEntryPermit(value: string | null | undefined): string | null {
  const compact = value?.replace(/[\s_-]+/g, '').toUpperCase();
  if (!compact) return null;
  return compact.replace(/^([A-Z]+)(\d+)$/, '$1-$2');
}

/**
 * Desk reasons why the holder cannot take the exemption; empty when it can.
 * Shown next to the disabled "No residente – exento de IVA" box.
 */
export function vatExemptionBlockers(
  rnt_number: string | null | undefined,
  holder: VatExemptionGuest | null,
): string[] {
  const reasons: string[] = [];
  if (!rnt_number?.trim()) {
    reasons.push('La tienda no tiene RNT: regístralo en Configuración → Hotelería');
  }
  if (!holder || !holder.is_primary) {
    reasons.push('Registra al titular de la reserva');
    return reasons;
  }
  if (holder.document_type !== 'PA') reasons.push('El titular debe identificarse con pasaporte');
  const nationality = holder.nationality_country_code?.trim().toUpperCase();
  if (!nationality || nationality === HOME_COUNTRY_CODE) {
    reasons.push('El titular debe tener nacionalidad extranjera');
  }
  if (!holder.is_non_resident) reasons.push('El titular debe estar marcado como no residente');
  const permit = normalizeEntryPermit(holder.entry_permit_type);
  if (!permit || !VAT_EXEMPT_ENTRY_PERMITS.includes(permit)) {
    reasons.push(
      `Falta el sello o permiso de ingreso (${VAT_EXEMPT_ENTRY_PERMITS.join(', ')})`,
    );
  }
  return reasons;
}

/** Tax row of a night line; the exempt one has no catalog tax rate behind it. */
export type NightTaxRow = Omit<FullTaxRow, 'tax_rate_id'> & { tax_rate_id: number | null };

/** True when the line carries the exempt VAT row. */
export function isVatExemptRow(row: { tax_name?: string | null; name?: string | null }): boolean {
  return (row.tax_name ?? row.name) === VAT_EXEMPTION_TAX_NAME;
}

/**
 * Tax rows of an exempt night: every VAT row becomes ONE VAT row at 0 % named
 * "Exento – art. 481 lit. d ET"; any other tax stays. All rows are exclusive,
 * so pricing the night at its pre-tax base (the base the catalog rows give
 * the night's rate) keeps that base and drops only the VAT. Without VAT
 * there is nothing to exempt and the rows come back unchanged.
 */
export function exemptNightTaxRows(rows: FullTaxRow[]): NightTaxRow[] {
  const vat = rows.filter((row) => row.tax_type === TaxFiscalType.IVA);
  if (vat.length === 0) return rows;
  const others = rows
    .filter((row) => row.tax_type !== TaxFiscalType.IVA)
    .map((row) => ({ ...row, is_inclusive: false }));
  return [
    {
      tax_rate_id: null,
      name: VAT_EXEMPTION_TAX_NAME,
      rate: 0,
      is_inclusive: false,
      tax_type: vat[0].tax_type,
    },
    ...others,
  ];
}
