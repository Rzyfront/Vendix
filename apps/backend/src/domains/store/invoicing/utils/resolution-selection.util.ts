import {
  internalSeriesPrefixFor,
  type FiscalDocumentType,
} from '../fiscal-document-requirements';

/**
 * LA regla única de selección de resolución de numeración.
 *
 * Toda la plataforma que necesite saber "¿qué resolución se usa para este
 * documento?" debe pasar por aquí; no reescribir el `where`:
 *  - `InvoiceNumberGenerator.generateNextNumber` (asigna el consecutivo),
 *  - `InvoicingService.peekResolutionForDraft` / `peekInternalSeries` (vista previa),
 *  - `SubscriptionFiscalService.allocateFiscalNumber` (facturas de plataforma),
 *  - los endpoints `GET .../resolutions/in-use` (`resolutions-in-use.util.ts`).
 *
 * Regla: la resolución ACTIVA y VIGENTE más recientemente creada de la entidad
 * contable y el tipo. Puro: sin Nest ni acceso a datos propio.
 */

export const ACTIVE_RESOLUTION_ORDER_BY = { created_at: 'desc' } as const;

export interface ActiveResolutionWhereParams {
  accounting_entity_id: number;
  document_type: FiscalDocumentType | string;
  now: Date;
  resolution_id?: number | null;
}

/** `where` de la resolución activa y vigente (opcionalmente una concreta). */
export function activeResolutionWhere(params: ActiveResolutionWhereParams) {
  const { accounting_entity_id, document_type, now, resolution_id } = params;
  return {
    accounting_entity_id,
    document_type: document_type as FiscalDocumentType,
    is_active: true,
    valid_from: { lte: now },
    valid_to: { gte: now },
    ...(resolution_id ? { id: resolution_id } : {}),
  };
}

export interface DormantInternalSeriesWhereParams {
  accounting_entity_id: number;
  document_type: FiscalDocumentType | string;
}

/**
 * `where` de la búsqueda de la serie interna "dormida": SIN filtro de
 * `is_active` ni de vigencia, porque busca justo la que quedó inactiva/vencida.
 */
export function dormantInternalSeriesWhere(
  params: DormantInternalSeriesWhereParams,
) {
  return {
    accounting_entity_id: params.accounting_entity_id,
    document_type: params.document_type as FiscalDocumentType,
  };
}

/** `client` = `tx` o prisma `withoutScope()`. */
export function findActiveResolution(
  client: any,
  params: ActiveResolutionWhereParams,
): Promise<any | null> {
  return client.invoice_resolutions.findFirst({
    where: activeResolutionWhere(params),
    orderBy: ACTIVE_RESOLUTION_ORDER_BY,
  });
}

export function findDormantInternalSeries(
  client: any,
  params: DormantInternalSeriesWhereParams,
): Promise<any | null> {
  return client.invoice_resolutions.findFirst({
    where: dormantInternalSeriesWhere(params),
    orderBy: ACTIVE_RESOLUTION_ORDER_BY,
  });
}

/**
 * Tipos de documento con UNA sola serie activa por entidad: los que tienen
 * serie interna (notas). `sales_invoice` y el resto pueden tener varias.
 */
export function isSingleActiveDocumentType(
  document_type: FiscalDocumentType | string,
): boolean {
  return internalSeriesPrefixFor(document_type as FiscalDocumentType) !== null;
}

/**
 * Desactiva las demás series activas de la nota (misma entidad y tipo) dentro
 * de la transacción `tx`. Devuelve los ids desactivados. No hace nada para
 * tipos que no son de nota.
 */
export async function deactivateOtherActiveSeries(
  tx: any,
  params: {
    accounting_entity_id: number;
    document_type: FiscalDocumentType | string;
    keep_id: number;
  },
): Promise<number[]> {
  if (!isSingleActiveDocumentType(params.document_type)) return [];
  const where = {
    accounting_entity_id: params.accounting_entity_id,
    document_type: params.document_type as FiscalDocumentType,
    is_active: true,
    id: { not: params.keep_id },
  };
  const others: Array<{ id: number }> = await tx.invoice_resolutions.findMany({
    where,
    select: { id: true },
  });
  if (others.length === 0) return [];
  await tx.invoice_resolutions.updateMany({
    where,
    data: { is_active: false },
  });
  return others.map((o) => o.id);
}

/** Llave del advisory lock de una serie: (entidad contable, tipo). */
export const resolutionSeriesLockKey = (
  accounting_entity_id: number,
  document_type: FiscalDocumentType | string,
): string => `invoice_resolution:${accounting_entity_id}:${document_type}`;

/**
 * Toma el `pg_advisory_xact_lock` de la serie dentro de `tx`. ÚNICA definición
 * de la llave: la comparten el generador de consecutivos y los alta/edición de
 * resoluciones, para serializar la emisión contra las activaciones.
 */
export async function lockResolutionSeries(
  tx: any,
  params: {
    accounting_entity_id: number;
    document_type: FiscalDocumentType | string;
  },
): Promise<void> {
  // pg_advisory_xact_lock returns void — must use $executeRaw, not $queryRaw.
  // Prisma's driver adapter (7.4.1) cannot map a `void` result column and
  // throws P2010 UnsupportedNativeDataType when this runs through $queryRaw.
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    resolutionSeriesLockKey(
      params.accounting_entity_id,
      params.document_type,
    ),
  );
}
