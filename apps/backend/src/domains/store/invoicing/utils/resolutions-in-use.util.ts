import {
  FISCAL_DOCUMENT_TYPES,
  internalSeriesPrefixFor,
  type FiscalDocumentType,
} from '../fiscal-document-requirements';
import {
  activeResolutionWhere,
  findActiveResolution,
  findDormantInternalSeries,
  isSingleActiveDocumentType,
} from './resolution-selection.util';
import {
  buildInternalSeriesDefaults,
  internalSeriesValidTo,
} from './invoice-number-generator';

/** Fila (real o proyectada) con la forma de `invoice_resolutions`. */
export interface ProjectedInternalSeries {
  id: number | null;
  resolution_number: string;
  prefix: string | null;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: Date;
  valid_to: Date;
  is_active: boolean;
  technical_key: string | null;
  technical_key_encrypted: string | null;
}

/**
 * La serie INTERNA que `provisionInternalSeries` abriría o reactivaría, tal
 * como quedaría, sin escribirla. Dormida -> reactivada conservando su cursor;
 * sin fila -> los defaults de una serie nueva (`id` null). `null` si el tipo no
 * tiene serie interna. El short-circuit de `requested_resolution_id` lo
 * conserva el llamador.
 */
export async function projectInternalSeries(
  client: any,
  params: {
    accounting_entity_id: number;
    document_type: FiscalDocumentType | string;
    now: Date;
  },
): Promise<ProjectedInternalSeries | null> {
  const { accounting_entity_id, document_type, now } = params;
  const prefix = internalSeriesPrefixFor(document_type as FiscalDocumentType);
  if (!prefix) return null;

  // MISMA consulta que `provisionInternalSeries`: sin filtro de vigencia ni de
  // `is_active`, porque lo que busca es precisamente la serie dormida.
  const dormant = await findDormantInternalSeries(client, {
    accounting_entity_id,
    document_type,
  });

  if (dormant) {
    return {
      id: dormant.id,
      resolution_number: dormant.resolution_number,
      prefix: dormant.prefix,
      range_from: dormant.range_from,
      range_to: dormant.range_to,
      // El cursor SE CONSERVA. El generador reactiva la fila sin tocarlo;
      // devolverlo en cero anunciaría un número ya emitido.
      current_number: dormant.current_number,
      valid_from: now,
      valid_to: internalSeriesValidTo(now),
      is_active: true,
      technical_key: dormant.technical_key,
      technical_key_encrypted: dormant.technical_key_encrypted,
    };
  }

  return {
    id: null,
    ...buildInternalSeriesDefaults(prefix, now),
    // Sin ClTec, igual que la serie que se escribiría.
    technical_key_encrypted: null,
  };
}

export interface ResolutionInUse {
  document_type: FiscalDocumentType;
  source: 'resolution' | 'internal_series_projected' | 'none';
  resolution_id: number | null;
  prefix: string | null;
  resolution_number: string | null;
  next_number: string | null;
  valid_to: string | null;
  is_internal_series: boolean;
  active_count: number;
  single_active_enforced: boolean;
}

export interface ResolutionsInUseResponse {
  accounting_entity_id: number;
  items: ResolutionInUse[];
}

const nextNumberOf = (row: {
  prefix: string | null;
  range_from: number;
  current_number: number;
}): string => {
  const floor = row.range_from - 1;
  const cursor = row.current_number < floor ? floor : row.current_number;
  return `${row.prefix ?? ''}${cursor + 1}`;
};

/**
 * Para CADA tipo fiscal, qué resolución tomaría hoy el generador. Usa la misma
 * regla (`resolution-selection.util`). Nunca expone `technical_key*`.
 *
 * `sales_invoice_resolution_id`: la plataforma no toma "la más reciente" para
 * `sales_invoice` sino la configurada; si se pasa la clave (aunque sea null)
 * el tipo se filtra por ese id y, sin id, queda `none`.
 */
export async function buildResolutionsInUse(
  client: any,
  params: {
    accounting_entity_id: number;
    now: Date;
    sales_invoice_resolution_id?: number | null;
  },
): Promise<ResolutionsInUseResponse> {
  const { accounting_entity_id, now } = params;
  const restrict_sales = params.sales_invoice_resolution_id !== undefined;

  const items: ResolutionInUse[] = [];
  for (const document_type of FISCAL_DOCUMENT_TYPES) {
    const is_internal_series = internalSeriesPrefixFor(document_type) !== null;
    const single_active_enforced = isSingleActiveDocumentType(document_type);
    const restricted = restrict_sales && document_type === 'sales_invoice';

    const active_count: number = await client.invoice_resolutions.count({
      where: activeResolutionWhere({
        accounting_entity_id,
        document_type,
        now,
      }),
    });

    const base = {
      document_type,
      is_internal_series,
      active_count,
      single_active_enforced,
    };
    const none: ResolutionInUse = {
      ...base,
      source: 'none',
      resolution_id: null,
      prefix: null,
      resolution_number: null,
      next_number: null,
      valid_to: null,
    };

    if (restricted && !params.sales_invoice_resolution_id) {
      items.push(none);
      continue;
    }

    const row = await findActiveResolution(client, {
      accounting_entity_id,
      document_type,
      now,
      resolution_id: restricted ? params.sales_invoice_resolution_id : null,
    });

    if (row) {
      items.push({
        ...base,
        source: 'resolution',
        resolution_id: row.id,
        prefix: row.prefix ?? null,
        resolution_number: row.resolution_number ?? null,
        next_number: nextNumberOf(row),
        valid_to: row.valid_to ? new Date(row.valid_to).toISOString() : null,
      });
      continue;
    }

    const projected = await projectInternalSeries(client, {
      accounting_entity_id,
      document_type,
      now,
    });
    if (projected) {
      items.push({
        ...base,
        source: 'internal_series_projected',
        resolution_id: projected.id,
        prefix: projected.prefix,
        resolution_number: projected.resolution_number,
        next_number: nextNumberOf(projected),
        valid_to: projected.valid_to.toISOString(),
      });
      continue;
    }

    items.push(none);
  }

  return { accounting_entity_id, items };
}
