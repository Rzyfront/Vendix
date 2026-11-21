import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  localCivil,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../../common/utils/store-timezone.util';
import { industryAllowsKey } from '../../../../common/access/module-industries';
import { hasPrivilegedRole } from '../../../../common/utils/privileged-roles.util';

/**
 * What the welcome screen needs to know about the store right now. Counts
 * only: no names, amounts or rows ever leave the server through this path.
 */
export interface VexStoreSnapshot {
  /** The store tracks stock at all (it has at least one stock row). */
  has_inventory: boolean;
  /** Stock rows at or below their reorder point. */
  low_stock_count: number;
  /** Cash register sessions still open. */
  open_cash_sessions: number;
  /** The user's pending reminders due before the store's day ends (overdue included). */
  reminders_due_today: number;
}

/**
 * Stable ids the client maps to its own wording (`vex-copy.ts`); the server
 * never sends user-facing text for a suggestion.
 */
export type VexSuggestionId =
  | 'reminders_today'
  | 'cash_close'
  | 'restock'
  | 'sales_today'
  | 'top_products'
  | 'overdue_receivables';

export interface VexSuggestion {
  id: VexSuggestionId;
  /** How many records back the suggestion, when it comes from a pending item. */
  count?: number;
}

/** Most suggestions the welcome screen shows. */
export const VEX_SUGGESTIONS_MAX = 4;

/**
 * Panel module that must be visible for a suggestion to be offered. Keys are
 * the `panel_ui` / `MODULE_INDUSTRIES` keys; reminders have no module gate.
 */
export const VEX_SUGGESTION_MODULE: Partial<Record<VexSuggestionId, string>> = {
  cash_close: 'settings_cash_registers',
  restock: 'inventory',
  sales_today: 'orders_sales',
  top_products: 'products',
  overdue_receivables: 'cartera_receivables',
};

/** Decides if a suggestion may be offered (industry, store and user panel_ui, role). */
export type VexSuggestionVisibility = (id: VexSuggestionId) => boolean;

/**
 * Orders the welcome suggestions for one store: real pending work first
 * (reminders due, an open cash register, stock under its minimum), then the
 * evergreen questions. A store without inventory never sees stock questions.
 */
export function buildVexSuggestions(
  snapshot: VexStoreSnapshot,
  isVisible: VexSuggestionVisibility = () => true,
): VexSuggestion[] {
  const suggestions: VexSuggestion[] = [];
  if (snapshot.reminders_due_today > 0) {
    suggestions.push({ id: 'reminders_today', count: snapshot.reminders_due_today });
  }
  if (snapshot.open_cash_sessions > 0) {
    suggestions.push({ id: 'cash_close', count: snapshot.open_cash_sessions });
  }
  if (snapshot.has_inventory && snapshot.low_stock_count > 0) {
    suggestions.push({ id: 'restock', count: snapshot.low_stock_count });
  }
  suggestions.push({ id: 'sales_today' });
  if (snapshot.has_inventory) suggestions.push({ id: 'top_products' });
  suggestions.push({ id: 'overdue_receivables' });
  return suggestions
    .filter((suggestion) => isVisible(suggestion.id))
    .slice(0, VEX_SUGGESTIONS_MAX);
}

type PanelUiMap = Record<string, unknown> | undefined;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `panel_ui.STORE_ADMIN` of a settings blob; anything malformed means «no data». */
function storeAdminPanelUi(blob: unknown): PanelUiMap {
  return asRecord(asRecord(asRecord(blob)?.panel_ui)?.STORE_ADMIN);
}

/**
 * Same chain as the sidebar (`vendix-panel-ui`, AND): industry, store panel
 * UI (`=== false` hides), user panel UI (`=== false` hides for privileged
 * roles, whose defaults fill absent keys; others need `=== true`; the owner
 * bypasses it). Missing data never restricts.
 */
export function buildVexVisibility(input: {
  industries?: readonly string[] | null;
  storePanelUi?: PanelUiMap;
  userPanelUi?: PanelUiMap;
  isOwner: boolean;
  roles: readonly string[];
}): VexSuggestionVisibility {
  const privileged = input.isOwner || hasPrivilegedRole(input.roles);
  return (id) => {
    const key = VEX_SUGGESTION_MODULE[id];
    if (!key) return true;
    if (!industryAllowsKey(key, input.industries)) return false;
    if (input.storePanelUi?.[key] === false) return false;
    if (input.isOwner) return true;
    const userValue = input.userPanelUi?.[key];
    return privileged ? userValue !== false : userValue === true;
  };
}

/** Snapshot used when a count cannot be read: only the evergreen questions. */
const EMPTY_SNAPSHOT: VexStoreSnapshot = {
  has_inventory: false,
  low_stock_count: 0,
  open_cash_sessions: 0,
  reminders_due_today: 0,
};

@Injectable()
export class VexSuggestionsService {
  private readonly logger = new Logger(VexSuggestionsService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /** Welcome suggestions for the caller's store and user. */
  async getSuggestions(): Promise<VexSuggestion[]> {
    const [snapshot, isVisible] = await Promise.all([
      this.readSnapshot(),
      this.readVisibility(),
    ]);
    return buildVexSuggestions(snapshot, isVisible);
  }

  /**
   * Industry and `panel_ui` of the caller's store and user. Every read is
   * keyed by the context store/user; a failed or missing read means «no
   * extra restriction» (never throws).
   */
  async readVisibility(): Promise<VexSuggestionVisibility> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const userId = context?.user_id;
    if (!storeId) return () => true;

    const [store, storeSettings, userSettings] = await Promise.all([
      this.safeRead('industries', () =>
        this.prisma.stores.findUnique({
          where: { id: storeId },
          select: { industries: true },
        }),
      ),
      this.safeRead('store panel_ui', () =>
        this.prisma.store_settings.findFirst({
          where: { store_id: storeId },
          select: { settings: true },
        }),
      ),
      userId
        ? this.safeRead('user panel_ui', () =>
            this.prisma.user_settings.findFirst({
              where: { user_id: userId },
              select: { config: true },
            }),
          )
        : Promise.resolve(null),
    ]);

    return buildVexVisibility({
      industries: store?.industries,
      storePanelUi: storeAdminPanelUi(
        (storeSettings as { settings?: unknown } | null)?.settings,
      ),
      userPanelUi: storeAdminPanelUi(
        (userSettings as { config?: unknown } | null)?.config,
      ),
      isOwner: context?.is_owner === true,
      roles: context?.roles ?? [],
    });
  }

  private async safeRead<T>(label: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Vex suggestions: could not read ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Four cheap counts, each scoped to the store by `StorePrismaService`. A
   * failed count degrades to zero: the welcome screen must never break
   * because a secondary signal could not be read.
   */
  async readSnapshot(): Promise<VexStoreSnapshot> {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const userId = context?.user_id;
    if (!storeId) return EMPTY_SNAPSHOT;

    const [stockRows, lowStock, openCash, remindersDue] = await Promise.all([
      this.safeCount('stock', () => this.prisma.stock_levels.count()),
      this.safeCount('low_stock', () =>
        this.prisma.stock_levels.count({
          where: {
            reorder_point: { not: null },
            quantity_available: {
              lte: this.prisma.stock_levels.fields.reorder_point,
            },
          },
        }),
      ),
      this.safeCount('cash', () =>
        this.prisma.cash_register_sessions.count({ where: { status: 'open' } }),
      ),
      userId
        ? this.safeCount('reminders', async () =>
            this.prisma.user_reminders.count({
              where: {
                user_id: userId,
                status: 'pending',
                remind_at: { lt: await this.tomorrowStart(storeId) },
              },
            }),
          )
        : Promise.resolve(0),
    ]);

    return {
      has_inventory: stockRows > 0,
      low_stock_count: lowStock,
      open_cash_sessions: openCash,
      reminders_due_today: remindersDue,
    };
  }

  /** First instant of the store's next civil day. */
  private async tomorrowStart(storeId: number): Promise<Date> {
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const civil = localCivil(new Date(), tz);
    return zonedWallClockToUtc(civil.year, civil.month, civil.day + 1, 0, 0, 0, 0, tz);
  }

  private async safeCount(label: string, read: () => Promise<number>): Promise<number> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Vex suggestions: could not read ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
