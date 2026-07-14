import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

/**
 * Single source of truth for the menu availability-window algorithm.
 *
 * Extracted so the public carta endpoint (`catalog.getPublicMenus`) and the
 * purchase paths (`cart.addItem`, `checkout.checkout`/`whatsappCheckout`) all
 * decide "is this product available right now?" with the EXACT same timezone
 * math and OR semantics — instead of each duplicating `getDateInTimezone` /
 * `isWindowActive`.
 *
 * Algorithm (mirrors the carta display):
 *  - A window is active now when `day_of_week === today` and the current
 *    minute-of-day is within `[start_time, end_time]` (inclusive), evaluated
 *    in the store timezone.
 *  - A product reachable through `menu_section_items` is gated by the UNION of
 *    its section's windows and its parent menu's windows (OR semantics at the
 *    menu/section level): if ANY of those windows is active now, the product is
 *    available.
 *  - A product NOT in any active menu, or only in menus/sections WITHOUT
 *    windows, is ALWAYS available (windows are opt-in gating; no window means
 *    no restriction). This is what keeps retail catalog untouched.
 */
export interface AvailabilityWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * Per-product availability contract shared with the storefront catalog (card +
 * detail). `next_available` is only populated when `is_available_now === false`.
 * A product not gated by any window is always `{ is_available_now: true,
 * next_available: null }` — this is what keeps retail products untouched.
 */
export interface ProductAvailability {
  is_available_now: boolean;
  next_available: { day_of_week: number; start_time: string } | null;
}

@Injectable()
export class MenuAvailabilityCheckerService {
  constructor(private readonly storePrisma: StorePrismaService) {}

  /**
   * Day-of-week (0=Sun..6=Sat) and minute-of-day in the given timezone using
   * Intl.DateTimeFormat. Identical to the implementation previously inlined in
   * catalog.service / schedule-validation.service.
   */
  getDateInTimezone(timezone: string): {
    day: number;
    hours: number;
    minutes: number;
  } {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);
      const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
      // ICU portability: with hour12:false some runtimes use hourCycle 'h24'
      // and render midnight as "24" (00:00-00:59 → hour "24"), while others use
      // 'h23' ("00"). Normalize 24 → 0 so minute-of-day math stays in [0,1439].
      const hoursVal =
        parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10) % 24;
      const minutesVal = parseInt(
        parts.find((p) => p.type === 'minute')?.value || '0',
        10,
      );
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      return {
        day: weekdayMap[weekdayStr] ?? now.getDay(),
        hours: hoursVal,
        minutes: minutesVal,
      };
    } catch {
      return {
        day: now.getDay(),
        hours: now.getHours(),
        minutes: now.getMinutes(),
      };
    }
  }

  /**
   * True when the window covers the supplied day/minute-of-day. Same rule used
   * by the carta endpoint: same day-of-week and inclusive minute range.
   */
  isWindowActive(
    w: { day_of_week: number; start_time: string; end_time: string },
    nowDay: number,
    nowMinutes: number,
  ): boolean {
    if (w.day_of_week !== nowDay) return false;
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const start = toMinutes(w.start_time);
    const end = toMinutes(w.end_time);
    return nowMinutes >= start && nowMinutes <= end;
  }

  /**
   * Resolve the store timezone from store_settings (defaults to America/Bogota).
   * The `stores` getter is unscoped on StorePrismaService, so we filter by
   * store_id explicitly (vendix-prisma-scopes).
   */
  async getStoreTimezone(storeId: number): Promise<string> {
    const store = await this.storePrisma.stores.findFirst({
      where: { id: storeId },
      select: { store_settings: { select: { settings: true } } },
    });
    return (
      ((store?.store_settings?.settings as any)?.general?.timezone as string) ||
      'America/Bogota'
    );
  }

  /**
   * Of the supplied product ids, return the subset that is currently BLOCKED by
   * menu availability windows — i.e. the product is referenced by one or more
   * `menu_section_items` belonging to ACTIVE menus that HAVE windows, and NONE
   * of the union of those (section ∪ menu) windows is active right now.
   *
   * Products that are not in any active menu, or whose gating windows are empty,
   * are NEVER in the returned set (no restriction). Computed once with a single
   * query and reused across cart/checkout item loops (no per-item DB round
   * trips).
   *
   * Tenant scope: filtered by explicit `store_id` on every model read, matching
   * the carta endpoint's store-scoped reads.
   */
  async getBlockedProductIds(
    storeId: number,
    productIds: number[],
  ): Promise<Set<number>> {
    const blocked = new Set<number>();
    const gatingByProduct = await this.loadProductGatingWindows(
      storeId,
      productIds,
    );
    if (gatingByProduct.length === 0) return blocked;

    const timezone = await this.getStoreTimezone(storeId);
    // getDateInTimezone devuelve `minutes` como minuto-de-la-hora (0-59), no
    // minuto-del-día. isWindowActive espera minuto-del-día, así que hay que
    // componer `hours * 60 + minutes` (mismo patrón que membership-access).
    const { day: nowDay, hours, minutes } = this.getDateInTimezone(timezone);
    const nowMinutes = hours * 60 + minutes;

    // A product can appear in several sections/menus. It is AVAILABLE as soon as
    // ANY of its gating contexts is open (or windowless). It is BLOCKED only if
    // EVERY context that references it has windows AND none is active now.
    const availableProductIds = new Set<number>();
    const windowedButClosed = new Set<number>();

    for (const entry of gatingByProduct) {
      const gatingWindows = entry.gatingWindows;
      const isAvailableHere =
        gatingWindows.length === 0 ||
        gatingWindows.some((w) => this.isWindowActive(w, nowDay, nowMinutes));

      if (isAvailableHere) {
        availableProductIds.add(entry.product_id);
      } else {
        windowedButClosed.add(entry.product_id);
      }
    }

    // Blocked = referenced somewhere with a closed windowed context AND never
    // reachable through an open/windowless context.
    for (const productId of windowedButClosed) {
      if (!availableProductIds.has(productId)) {
        blocked.add(productId);
      }
    }

    return blocked;
  }

  /**
   * Shared window loader for `getBlockedProductIds` and `getAvailabilityMap`.
   * Returns, per `menu_section_items` row referencing one of `productIds` in an
   * ACTIVE menu, the UNION (section ∪ parent-menu) of availability windows that
   * gate that product in that context. A single query, no timezone math here —
   * both public methods add the "now" evaluation on top of this raw gating set.
   *
   * Tenant scope: filtered by explicit `store_id` on every model read, matching
   * the carta endpoint's store-scoped reads (vendix-prisma-scopes).
   */
  private async loadProductGatingWindows(
    storeId: number,
    productIds: number[],
  ): Promise<
    Array<{ product_id: number; gatingWindows: AvailabilityWindow[] }>
  > {
    const uniqueIds = Array.from(new Set(productIds)).filter((id) =>
      Number.isFinite(id),
    );
    if (uniqueIds.length === 0) return [];

    // All section-items of these products that live in ACTIVE menus. We pull
    // the section windows and the parent-menu windows in one query so the
    // gating set per (product, section) is the section ∪ menu union.
    const items = await this.storePrisma.menu_section_items.findMany({
      where: {
        product_id: { in: uniqueIds },
        menu_section: {
          store_id: storeId,
          menu: { store_id: storeId, is_active: true },
        },
      },
      select: {
        product_id: true,
        menu_section: {
          select: {
            availability_windows: {
              select: { day_of_week: true, start_time: true, end_time: true },
            },
            menu: {
              select: {
                availability_windows: {
                  select: {
                    day_of_week: true,
                    start_time: true,
                    end_time: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return items.map((item) => {
      const sectionWindows = item.menu_section?.availability_windows ?? [];
      const menuWindows = item.menu_section?.menu?.availability_windows ?? [];
      return {
        product_id: item.product_id,
        gatingWindows: [
          ...sectionWindows,
          ...menuWindows,
        ] as AvailabilityWindow[],
      };
    });
  }

  /**
   * Per-product availability for the storefront catalog (card + detail),
   * computed with the SAME window loader, timezone resolution and OR semantics
   * as `getBlockedProductIds` — the single source of truth. For each requested
   * id:
   *  - `is_available_now`: false only when EVERY context referencing it has
   *    windows and none is active now (identical to the "blocked" definition).
   *  - `next_available`: the soonest upcoming window across the union of all
   *    gating windows that reference the product, ONLY when it is not available
   *    now; otherwise null.
   *  - A product not reachable through any `menu_section_items`, or only through
   *    windowless contexts, is `{ is_available_now: true, next_available: null }`
   *    (retail stays untouched).
   *
   * Timezone and "now" are resolved internally; the caller never passes them.
   */
  async getAvailabilityMap(
    storeId: number,
    productIds: number[],
  ): Promise<Map<number, ProductAvailability>> {
    const map = new Map<number, ProductAvailability>();
    const uniqueIds = Array.from(new Set(productIds)).filter((id) =>
      Number.isFinite(id),
    );
    if (uniqueIds.length === 0) return map;

    // Default: every requested product is available with no restriction. Only
    // products gated by a closed window get downgraded below.
    for (const id of uniqueIds) {
      map.set(id, { is_available_now: true, next_available: null });
    }

    const gatingByProduct = await this.loadProductGatingWindows(
      storeId,
      uniqueIds,
    );
    if (gatingByProduct.length === 0) return map;

    const timezone = await this.getStoreTimezone(storeId);
    // getDateInTimezone devuelve `minutes` como minuto-de-la-hora (0-59), no
    // minuto-del-día. isWindowActive espera minuto-del-día, así que hay que
    // componer `hours * 60 + minutes` (mismo patrón que membership-access).
    const { day: nowDay, hours, minutes } = this.getDateInTimezone(timezone);
    const nowMinutes = hours * 60 + minutes;

    // OR semantics: available as soon as ANY gating context is open (or
    // windowless). Accumulate the full window union per product so, when it ends
    // up blocked, `next_available` scans every window that references it.
    const availableProductIds = new Set<number>();
    const windowsByProduct = new Map<number, AvailabilityWindow[]>();

    for (const entry of gatingByProduct) {
      const gatingWindows = entry.gatingWindows;
      const accumulated = windowsByProduct.get(entry.product_id) ?? [];
      windowsByProduct.set(entry.product_id, [
        ...accumulated,
        ...gatingWindows,
      ]);

      const isAvailableHere =
        gatingWindows.length === 0 ||
        gatingWindows.some((w) => this.isWindowActive(w, nowDay, nowMinutes));
      if (isAvailableHere) {
        availableProductIds.add(entry.product_id);
      }
    }

    for (const [productId, windows] of windowsByProduct) {
      const isAvailable = availableProductIds.has(productId);
      map.set(productId, {
        is_available_now: isAvailable,
        next_available: isAvailable
          ? null
          : this.nextAvailableWindow(windows, nowDay, nowMinutes),
      });
    }

    return map;
  }

  /**
   * Soonest upcoming window (within a week) as {day_of_week, start_time}, or
   * null when there are no windows. Centralized here as the single source of
   * truth for "próxima ventana". `catalog.getPublicMenus` still keeps its own
   * private copy for the carta view — that dedup is a deferred follow-up.
   */
  private nextAvailableWindow(
    windows: AvailabilityWindow[],
    nowDay: number,
    nowMinutes: number,
  ): { day_of_week: number; start_time: string } | null {
    if (!windows || windows.length === 0) return null;
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    let best: { day_of_week: number; start_time: string } | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const w of windows) {
      const start = toMinutes(w.start_time);
      const dayDiff = (w.day_of_week - nowDay + 7) % 7;
      let delta = dayDiff * 1440 + (start - nowMinutes);
      if (delta <= 0) delta += 7 * 1440;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = { day_of_week: w.day_of_week, start_time: w.start_time };
      }
    }
    return best;
  }

  /**
   * Convenience single-product check used by `cart.addItem`. Returns true when
   * the product is currently blocked by menu availability windows.
   */
  async isProductBlockedNow(
    storeId: number,
    productId: number,
  ): Promise<boolean> {
    const blocked = await this.getBlockedProductIds(storeId, [productId]);
    return blocked.has(productId);
  }
}
