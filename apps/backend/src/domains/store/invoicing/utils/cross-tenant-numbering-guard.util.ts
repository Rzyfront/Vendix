import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import {
  internalSeriesPrefixFor,
  type FiscalDocumentType,
} from '../fiscal-document-requirements';

/**
 * Guarda de numeración entre cuentas.
 *
 * La DIAN numera por (NIT emisor, prefijo, tipo de documento). Dos cuentas
 * distintas pueden declarar el mismo NIT emisor (p. ej. tiendas demo que emiten
 * con el software de la plataforma); si registran el mismo prefijo + tipo con
 * rangos solapados emitirían consecutivos duplicados, y ese rechazo es definitivo.
 *
 * El «conjunto de NIT emisores» de una entidad contable es la unión de
 * `accounting_entities.tax_id` (puede ser un valor de semilla) y de
 * `dian_configurations.nit` (el que viaja en el XML). La consulta es de SOLO
 * LECTURA y cruza tenants a propósito: por eso recibe un cliente sin scope y
 * selecciona lo mínimo (rangos), nunca ids ni nombres ajenos.
 */

export interface CrossTenantNumberingParams {
  accounting_entity_id: number;
  document_type: string;
  prefix: string;
  range_from: number;
  range_to: number;
  exclude_resolution_id?: number;
  /**
   * Solo `true` cuando `prisma` es un `tx` interactivo: toma un advisory lock
   * transaccional por (NIT, prefijo, tipo) antes de leer, para que dos cuentas
   * que registran a la vez no pasen la guarda las dos.
   */
  lock_in_transaction?: boolean;
}

/** `900123456` -> `900.123.456` (separador de miles con puntos). */
function withThousandsDots(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Solo dígitos; si hay guion se descarta el DV (lo que sigue al último guion). */
export function normalizeIssuerNit(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  const dash = value.lastIndexOf('-');
  if (dash >= 0) value = value.slice(0, dash);
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** Solape inclusivo de [aFrom, aTo] con [bFrom, bTo]. */
export function rangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom <= bTo && aTo >= bFrom;
}

const normalizePrefix = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

export async function assertNoCrossTenantNumberingOverlap(
  prisma: any,
  params: CrossTenantNumberingParams,
): Promise<void> {
  // D10: las series internas de notas/ajustes (NC/ND/NCVS/NDVS/NAS/NAE) no tienen
  // guarda entre cuentas; la numeración no es de la DIAN sino nuestra. Misma
  // definición que `isSingleActiveDocumentType`: `internalSeriesPrefixFor !== null`.
  if (
    internalSeriesPrefixFor(params.document_type as FiscalDocumentType) !== null
  ) {
    return;
  }
  const target = await prisma.accounting_entities.findFirst({
    where: { id: params.accounting_entity_id },
    select: {
      tax_id: true,
      dian_configurations: { select: { nit: true } },
    },
  });
  if (!target) return;

  const nits = new Set<string>();
  const own_tax = normalizeIssuerNit(target.tax_id);
  if (own_tax) nits.add(own_tax);
  for (const dc of target.dian_configurations ?? []) {
    const n = normalizeIssuerNit(dc.nit);
    if (n) nits.add(n);
  }
  if (nits.size === 0) return;

  const digit_list = [...nits].sort();

  if (params.lock_in_transaction) {
    const prefix_key = normalizePrefix(params.prefix);
    for (const nit of digit_list) {
      const key = `numbering:${nit}:${prefix_key}:${params.document_type}`;
      await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }
  // Candidatos crudos: el valor guardado puede traer DV (`900123456-7`), por eso
  // `startsWith`. La confirmación exacta se hace en memoria tras normalizar.
  const candidates: Array<{
    id: number;
    tax_id: string | null;
    dian_configurations: Array<{ nit: string | null }>;
  }> = await prisma.accounting_entities.findMany({
    where: {
      OR: digit_list
        .flatMap((d) => [d, withThousandsDots(d)])
        .flatMap((v) => [
          { tax_id: { startsWith: v } },
          { dian_configurations: { some: { nit: { startsWith: v } } } },
        ]),
    },
    select: {
      id: true,
      tax_id: true,
      dian_configurations: { select: { nit: true } },
    },
  });

  const entity_ids = new Set<number>([params.accounting_entity_id]);
  for (const c of candidates) {
    const tax = normalizeIssuerNit(c.tax_id);
    const matches =
      (tax !== null && nits.has(tax)) ||
      (c.dian_configurations ?? []).some((dc) => {
        const n = normalizeIssuerNit(dc.nit);
        return n !== null && nits.has(n);
      });
    if (matches) entity_ids.add(c.id);
  }

  const wanted_prefix = normalizePrefix(params.prefix);
  const rows: Array<{
    prefix: string | null;
    range_from: number;
    range_to: number;
  }> = await prisma.invoice_resolutions.findMany({
    where: {
      accounting_entity_id: { in: [...entity_ids] },
      document_type: params.document_type,
      prefix: { equals: params.prefix.trim(), mode: 'insensitive' },
      range_from: { lte: params.range_to },
      range_to: { gte: params.range_from },
      ...(params.exclude_resolution_id !== undefined && {
        id: { not: params.exclude_resolution_id },
      }),
    },
    select: { prefix: true, range_from: true, range_to: true },
  });

  const conflicts = rows.filter(
    (r) =>
      normalizePrefix(r.prefix) === wanted_prefix &&
      rangesOverlap(
        params.range_from,
        params.range_to,
        r.range_from,
        r.range_to,
      ),
  );
  if (conflicts.length === 0) return;

  const occupied_ranges = conflicts.map((r) => ({
    from: r.range_from,
    to: r.range_to,
  }));
  const occupied_text = occupied_ranges
    .map((r) => `${r.from}–${r.to}`)
    .join(', ');
  const example =
    params.prefix.trim().toUpperCase() === 'SETP'
      ? ' Por ejemplo 994000000–994999999.'
      : '';

  throw new VendixHttpException(
    ErrorCodes.INVOICING_RESOLUTION_017,
    `El rango ${params.range_from}–${params.range_to} con prefijo "${params.prefix.trim()}" se cruza con el rango ${occupied_text}, que ya está registrado para este NIT emisor en la plataforma. Elige un sub-rango disjunto.${example}`,
    {
      prefix: params.prefix.trim(),
      document_type: params.document_type,
      requested_range_from: params.range_from,
      requested_range_to: params.range_to,
      occupied_ranges,
    },
  );
}
