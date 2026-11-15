import { forkJoin, Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

/** Minimal shape of a paginated API response needed to walk every page. */
export interface PagedChunk<T> {
  data?: T[] | null;
  meta?: { totalPages?: number } | null;
}

/**
 * Requests page 1 and, when the API reports more pages, requests the rest in
 * parallel and returns every item in page order. Used where the UI must show
 * the complete set (e.g. the organization sidebar store list, QUI-984) instead
 * of the API default page size.
 */
export function collectAllPages<T>(
  fetchPage: (page: number) => Observable<PagedChunk<T>>,
): Observable<T[]> {
  return fetchPage(1).pipe(
    switchMap((first) => {
      const firstItems = first?.data ?? [];
      const totalPages = first?.meta?.totalPages ?? 1;
      if (totalPages <= 1) return of(firstItems);

      const remaining = Array.from({ length: totalPages - 1 }, (_, i) =>
        fetchPage(i + 2),
      );
      return forkJoin(remaining).pipe(
        map((pages) => [
          ...firstItems,
          ...pages.flatMap((page) => page?.data ?? []),
        ]),
      );
    }),
  );
}
