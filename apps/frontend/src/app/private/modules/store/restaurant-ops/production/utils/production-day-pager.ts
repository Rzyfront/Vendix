import { signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ProductionDayCard, ProductionDayResponse } from '../interfaces';

/** Tamaño de página que piden todas las pantallas de la lista del día. */
export const PRODUCTION_DAY_PAGE_SIZE = 100;
/** Tope de `limit` que acepta el backend en una sola página. */
export const PRODUCTION_DAY_MAX_LIMIT = 500;

const dueMs = (card: ProductionDayCard): number => {
  const ms = card.due_at ? Date.parse(card.due_at) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/**
 * Mismo criterio del backend: `carried_over` primero y luego `due_at`
 * ascendente (sin hora al final). Estable: a igualdad conserva el orden previo.
 */
export function sortDayCards(cards: readonly ProductionDayCard[]): ProductionDayCard[] {
  return [...cards].sort((a, b) => {
    if (a.carried_over !== b.carried_over) return a.carried_over ? -1 : 1;
    const da = dueMs(a);
    const db = dueMs(b);
    if (da === db) return 0;
    return da < db ? -1 : 1;
  });
}

/**
 * Une una página nueva a las tarjetas cargadas: inserta las nuevas y reemplaza
 * las que ya estaban (misma `key`), nunca duplica, y reordena.
 */
export function mergeDayCards(
  existing: readonly ProductionDayCard[],
  incoming: readonly ProductionDayCard[],
): ProductionDayCard[] {
  const byKey = new Map<string, ProductionDayCard>();
  for (const card of existing) byKey.set(card.key, card);
  for (const card of incoming) byKey.set(card.key, card);
  return sortDayCards([...byKey.values()]);
}

/** Une una página al resultado acumulado; `summary` es el de la respuesta (día completo). */
export function mergeDayPage(
  acc: ProductionDayResponse,
  page: ProductionDayResponse,
): ProductionDayResponse {
  return { ...page, cards: mergeDayCards(acc.cards, page.cards) };
}

export type ProductionDayPageFetcher = (
  date: string,
  cursor: string | null,
  limit: number,
) => Observable<ProductionDayResponse>;

/**
 * Estado de la lista del día con scroll infinito (S20, release #1134).
 *
 * - `load` va siempre a la página 1; cambiar de día o un refresco en vivo
 *   cancelan lo que estuviera en vuelo, así una respuesta vieja nunca pisa una
 *   nueva ni mezcla días.
 * - Un refresco del mismo día (`resetView=false`) vuelve a pedir el tramo ya
 *   cargado en una sola página (hasta `PRODUCTION_DAY_MAX_LIMIT`), para que un
 *   evento en vivo no recorte la lista a la primera página.
 * - `loadMore` sigue `next_cursor` y une por `key`.
 * - `summary` viene de la respuesta (cuenta el día completo); no se recalcula.
 */
export class ProductionDayPager {
  readonly data = signal<ProductionDayResponse | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly errorMessage = signal<string | null>(null);
  /** La carga de la página siguiente falló: la pantalla ofrece reintentar. */
  readonly moreFailed = signal(false);

  private date: string | null = null;
  /** Páginas de `PRODUCTION_DAY_PAGE_SIZE` que cubre la lista en pantalla. */
  private pagesLoaded = 0;
  private firstSub: Subscription | null = null;
  private moreSub: Subscription | null = null;

  constructor(
    private readonly fetchPage: ProductionDayPageFetcher,
    private readonly loadErrorMessage: string,
  ) {}

  load(date: string, resetView: boolean): void {
    const keepSpan = !resetView && this.date === date && this.data() !== null;
    const limit = keepSpan
      ? Math.min(PRODUCTION_DAY_MAX_LIMIT, Math.max(1, this.pagesLoaded) * PRODUCTION_DAY_PAGE_SIZE)
      : PRODUCTION_DAY_PAGE_SIZE;
    this.cancel();
    this.date = date;
    if (resetView) this.data.set(null);
    this.loading.set(true);
    this.errorMessage.set(null);
    this.moreFailed.set(false);
    this.firstSub = this.fetchPage(date, null, limit).subscribe({
      next: (res) => {
        this.data.set({ ...res, cards: sortDayCards(res.cards) });
        this.pagesLoaded = Math.ceil(limit / PRODUCTION_DAY_PAGE_SIZE);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        // Un refresco de fondo que falla deja la lista en pantalla.
        if (!resetView && this.data()) return;
        this.errorMessage.set(typeof err === 'string' ? err : this.loadErrorMessage);
      },
    });
  }

  loadMore(): void {
    const current = this.data();
    const cursor = current?.next_cursor;
    const date = this.date;
    if (!cursor || date === null || this.loading() || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.moreSub = this.fetchPage(date, cursor, PRODUCTION_DAY_PAGE_SIZE).subscribe({
      next: (page) => {
        this.data.update((d) => (d ? mergeDayPage(d, page) : d));
        this.pagesLoaded += 1;
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        this.moreFailed.set(true);
      },
    });
  }

  /** Cancela lo que esté en vuelo (cambio de día o destrucción del componente). */
  cancel(): void {
    this.firstSub?.unsubscribe();
    this.moreSub?.unsubscribe();
    this.firstSub = null;
    this.moreSub = null;
    this.loadingMore.set(false);
  }
}
