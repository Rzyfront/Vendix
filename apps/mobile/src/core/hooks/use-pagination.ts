import { useState, useCallback } from 'react';

interface PaginationState {
  page: number;
  limit: number;
  total?: number;
}

interface UsePaginationOptions {
  initialPage?: number;
  initialLimit?: number;
}

export function usePagination(options: UsePaginationOptions = {}) {
  const { initialPage = 1, initialLimit = 20 } = options;
  const [pagination, setPagination] = useState<PaginationState>({
    page: initialPage,
    limit: initialLimit,
    total: undefined,
  });

  const setPage = useCallback((page: number) => {
    setPagination((prev) => ({ ...prev, page }));
  }, []);

  const setLimit = useCallback((limit: number) => {
    setPagination({ page: 1, limit, total: undefined });
  }, []);

  const setTotal = useCallback((total: number) => {
    setPagination((prev) => ({ ...prev, total }));
  }, []);

  const reset = useCallback(() => {
    setPagination({ page: initialPage, limit: initialLimit, total: undefined });
  }, [initialPage, initialLimit]);

  const totalPages = pagination.total
    ? Math.ceil(pagination.total / pagination.limit)
    : undefined;

  return {
    ...pagination,
    setPage,
    setLimit,
    setTotal,
    reset,
    totalPages,
    hasNextPage: totalPages ? pagination.page < totalPages : undefined,
    hasPrevPage: pagination.page > 1,
  };
}
