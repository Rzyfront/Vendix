import { normalizeToolResult } from './tool-result.normalizer';
import { catalogHash } from './tool-catalog';

export interface DiscoveryPage<T> {
  data: T[];
  total: number;
  has_more: boolean;
  cursor: string | null;
}
export const pageParameters = {
  cursor: {
    type: 'string',
    description:
      'Cursor opaco devuelto por la página anterior; se invalida si cambian catálogo o permisos.',
  },
  limit: {
    type: 'integer',
    description: 'Tamaño de página, de 1 a 20 (por defecto 5).',
  },
};

/** Bounded, stable pages bound to the authorized dataset. Never character slices. */
export function discoveryPage<T>(
  items: T[],
  args: { cursor?: unknown; limit?: unknown },
  identity: unknown,
  defaultLimit = 5,
): DiscoveryPage<T> {
  const fingerprint = catalogHash([identity, items]);
  const limit = args.limit == null ? defaultLimit : Number(args.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error('El límite debe ser un entero de 1 a 20.');
  let offset = 0;
  if (args.cursor != null) {
    if (typeof args.cursor !== 'string' || args.cursor.length > 300)
      throw new Error('Cursor inválido; vuelve a consultar sin cursor.');
    try {
      const parsed = JSON.parse(
        Buffer.from(args.cursor, 'base64url').toString('utf8'),
      );
      if (
        parsed.hash !== fingerprint ||
        !Number.isSafeInteger(parsed.offset) ||
        parsed.offset < 0 ||
        parsed.offset > items.length
      )
        throw new Error();
      offset = parsed.offset;
    } catch {
      throw new Error(
        'Cursor vencido o inválido; vuelve a consultar sin cursor con los permisos actuales.',
      );
    }
  }
  const data = items.slice(offset, offset + limit);
  const next = offset + data.length;
  return {
    data,
    total: items.length,
    has_more: next < items.length,
    cursor:
      next < items.length
        ? Buffer.from(
            JSON.stringify({ hash: fingerprint, offset: next }),
          ).toString('base64url')
        : null,
  };
}

export function discoveryError(error: unknown): string {
  return JSON.stringify({
    error: error instanceof Error ? error.message : 'Consulta inválida.',
    error_code: 'INVALID_DISCOVERY_PAGE',
    next_step:
      'Consulta una página válida; si cambió el catálogo empieza sin cursor.',
  });
}

/** JSON-safe data page; upstream pagination is retained separately, never called complete. */
export function bridgeDataPage(
  body: string,
  args: Record<string, unknown>,
  path: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return JSON.stringify({
      error: 'La ruta no devuelve datos JSON paginables.',
      error_code: 'UNSTRUCTURED_RESPONSE',
      next_step:
        'Usa el contrato del dominio o un endpoint de detalle; no deduzcas filas desde texto recortado.',
    });
  }
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  // Paging must never erase an HTTP200 business failure/pending/input/unknown
  // control envelope just because it also carries a data/results array.
  const normalized = normalizeToolResult(parsed);
  if (normalized.status !== 'ok') {
    if (body.length <= 5000) return body;
    return JSON.stringify({
      ...normalized,
      freshness: 'truncated',
      data: {
        note: 'Respuesta de control demasiado grande; no se trató como datos exitosos.',
      },
      next_action:
        normalized.next_action && normalized.next_action.length <= 500
          ? normalized.next_action
          : 'Consulta el contrato del dominio para corregir la consulta sin inventar datos.',
    });
  }
  let rows = Array.isArray(parsed) ? parsed : null;
  let container = record;
  let rowsPath = 'data';
  for (const key of ['data', 'items', 'rows', 'results']) {
    if (Array.isArray(record[key])) {
      rows = record[key] as unknown[];
      rowsPath = key;
      break;
    }
    if (key === 'data' && record.data && typeof record.data === 'object') {
      const nested = record.data as Record<string, unknown>;
      for (const sub of ['items', 'rows', 'results', 'data'])
        if (Array.isArray(nested[sub])) {
          rows = nested[sub] as unknown[];
          container = nested;
          rowsPath = `data.${sub}`;
          break;
        }
      if (rows) break;
    }
  }
  if (!rows && body.length <= 5000 && args.result_cursor == null) return body;
  if (!rows)
    return JSON.stringify({
      error:
        'El objeto excede el presupuesto de detalle; no se recortó como si fuera una página.',
      error_code: 'DETAIL_CONTRACT_REQUIRED',
      fields: Object.keys(record).slice(0, 30),
      next_step:
        'Consulta un endpoint de detalle o un filtro/campo documentado del dominio.',
    });
  const safeRows = rows.map((row) =>
    JSON.stringify(row).length <= 1500
      ? row
      : {
          omitted_large_row: true,
          id:
            row && typeof row === 'object'
              ? ((row as Record<string, unknown>).id ?? null)
              : null,
          fields:
            row && typeof row === 'object' ? Object.keys(row).slice(0, 20) : [],
          next_step:
            'Lee el detalle de este registro usando el contrato del dominio; esta referencia NO contiene todos los campos.',
        },
  );
  const page = discoveryPage(
    safeRows,
    { cursor: args.result_cursor, limit: args.result_limit },
    [path, rows],
    3,
  );
  const sourcePagination =
    container.pagination ??
    container.meta ??
    record.pagination ??
    record.meta ??
    null;
  return JSON.stringify({
    ...page,
    source_pagination: sourcePagination,
    source_rows_path: rowsPath,
    total: page.total,
    page_total: page.total,
    source_total:
      (sourcePagination as any)?.total ??
      container.total ??
      record.total ??
      null,
    complete: false, // Only a domain-specific verifier can prove the whole upstream dataset was read.
    ...(record.truncated === true ||
    container.truncated === true ||
    page.data.some(
      (r) => r && typeof r === 'object' && (r as any).omitted_large_row,
    )
      ? { truncated: true }
      : {}),
    next_step: page.has_more
      ? 'Continúa con result_cursor sin cambiar path/query; luego sigue la paginación upstream si existe.'
      : 'Esta respuesta cubre solo la página upstream solicitada. Usa su paginación documentada si necesitas más datos.',
  });
}
