import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  localCivil,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../../common/utils/store-timezone.util';

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
 * Orders the welcome suggestions for one store: real pending work first
 * (reminders due, an open cash register, stock under its minimum), then the
 * evergreen questions. A store without inventory never sees stock questions.
 */
export function buildVexSuggestions(snapshot: VexStoreSnapshot): VexSuggestion[] {
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
  return suggestions.slice(0, VEX_SUGGESTIONS_MAX);
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
    return buildVexSuggestions(await this.readSnapshot());
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
