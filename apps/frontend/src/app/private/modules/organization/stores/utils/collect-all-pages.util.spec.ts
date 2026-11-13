import { Observable, of, throwError } from 'rxjs';
import { collectAllPages, PagedChunk } from './collect-all-pages.util';

describe('collectAllPages (QUI-984)', () => {
  function pagedSource(
    pages: string[][],
    requested: number[],
  ): (page: number) => Observable<PagedChunk<string>> {
    return (page: number) => {
      requested.push(page);
      return of({
        data: pages[page - 1] ?? [],
        meta: { totalPages: pages.length },
      });
    };
  }

  it('returns the first page when it is the only one', () => {
    const requested: number[] = [];
    let result: string[] = [];

    collectAllPages(pagedSource([['a', 'b']], requested)).subscribe(
      (items) => (result = items),
    );

    expect(result).toEqual(['a', 'b']);
    expect(requested).toEqual([1]);
  });

  it('fetches every remaining page and keeps page order', () => {
    const requested: number[] = [];
    let result: string[] = [];

    collectAllPages(
      pagedSource([['s1', 's2'], ['s3', 's4'], ['s5']], requested),
    ).subscribe((items) => (result = items));

    expect(result).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(requested).toEqual([1, 2, 3]);
  });

  it('treats a response without data or meta as an empty single page', () => {
    const requested: number[] = [];
    let result: string[] | undefined;

    collectAllPages<string>((page) => {
      requested.push(page);
      return of({} as PagedChunk<string>);
    }).subscribe((items) => (result = items));

    expect(result).toEqual([]);
    expect(requested).toEqual([1]);
  });

  it('propagates an error from any page', () => {
    let error: unknown;

    collectAllPages<string>((page) =>
      page === 1
        ? of({ data: ['a'], meta: { totalPages: 2 } })
        : throwError(() => new Error('boom')),
    ).subscribe({ error: (err) => (error = err) });

    expect((error as Error).message).toBe('boom');
  });
});
