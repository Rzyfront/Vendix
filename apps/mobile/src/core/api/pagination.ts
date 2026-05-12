import type { ApiResponse, PaginatedResponse, PaginationMeta } from '@/features/store/types';

interface PaginationFallback {
  page?: number;
  limit?: number;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function unwrapPaginated<T>(
  response: { data: unknown },
  fallback: PaginationFallback = {},
): PaginatedResponse<T> {
  const body = response.data as ApiResponse<T[]> | { data?: T[]; meta?: unknown; pagination?: unknown } | T[];
  const raw = body && typeof body === 'object' && 'success' in body ? body.data : body;
  const data = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: T[] })?.data)
      ? ((raw as { data: T[] }).data)
      : [];

  const metaSource =
    (body && typeof body === 'object' && 'meta' in body ? body.meta : undefined) ||
    (raw && typeof raw === 'object' && 'meta' in raw ? (raw as { meta?: unknown }).meta : undefined) ||
    (raw && typeof raw === 'object' && 'pagination' in raw ? (raw as { pagination?: unknown }).pagination : undefined);

  const meta = (metaSource && typeof metaSource === 'object' && 'pagination' in metaSource
    ? (metaSource as { pagination?: unknown }).pagination
    : metaSource) as Partial<PaginationMeta> & { total_pages?: number } | undefined;

  const page = toNumber(meta?.page, fallback.page ?? 1);
  const limit = toNumber(meta?.limit, fallback.limit ?? Math.max(data.length, 1));
  const total = toNumber(meta?.total, data.length);
  const totalPages = toNumber(meta?.totalPages ?? meta?.total_pages, Math.max(1, Math.ceil(total / limit)));

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: meta?.hasNext ?? page < totalPages,
      hasPrev: meta?.hasPrev ?? page > 1,
    },
  };
}

export function getNextPageParam<T>(lastPage?: PaginatedResponse<T>): number | undefined {
  const pagination = lastPage?.pagination;
  if (!pagination) return undefined;
  return pagination.page < pagination.totalPages ? pagination.page + 1 : undefined;
}
