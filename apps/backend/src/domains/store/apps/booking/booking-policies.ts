import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';
import { asPolicySnapshot } from '../../hospitality/rates/lodging-cancellation-penalty';
import { toPolicySnapshot } from '../../hospitality/rates/cancellation-policies.service';
import { policyText } from '../../hospitality/reservations/booking-engine/booking-engine-text';
import { AppPageBlock, AppPageDocument } from '../shared/app-page.contract';

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "15:00" → "3:00 p. m."; noon is "12:00 m."; null when not HH:mm. */
function clock(time: string, noonSuffix: boolean): string | null {
  const m = TIME.exec((time ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minutes = m[2];
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour === 12 && minutes === '00' && noonSuffix ? 'm.' : hour < 12 ? 'a. m.' : 'p. m.';
  return `${h12}:${minutes} ${suffix}`;
}

export function formatCheckIn(time: string): string | null {
  const text = clock(time, false);
  return text ? `Desde las ${text}` : null;
}

export function formatCheckOut(time: string): string | null {
  const text = clock(time, true);
  return text ? `Hasta las ${text}` : null;
}

export interface PolicyDefaults {
  check_in?: string | null;
  check_out?: string | null;
  cancellation?: string | null;
}

const POLICY_KEYS = ['check_in', 'check_out', 'cancellation'] as const;

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === '';

function needsFill(block: AppPageBlock): boolean {
  return block.type === 'policies' && block.enabled && POLICY_KEYS.some((k) => isBlank(block.props?.[k]));
}

/**
 * Apps booking-detail — the hotel's real data behind the `stay_detail` block
 * and the `visible_when` conditions of the booking page. Nothing here is typed
 * by the owner: times come from the store settings, cancellation and deposit
 * from the default rate plan, capacity and photos from the active room types.
 */
export interface BookingStayFacts {
  /** "Desde las 3:00 p. m." */
  check_in: string | null;
  /** "Hasta las 12:00 m." */
  check_out: string | null;
  /** Policy text of the default rate plan. */
  cancellation: string | null;
  /** Most guests the largest active room type takes. */
  max_guests: number | null;
  /** Deposit (% of the stay) of the default rate plan; `null` without one. */
  deposit_percent: number | null;
  /** Some active room type has photos (`visible_when.has_photos`). */
  has_photos: boolean;
  /** Some room type can be booked (`visible_when.has_availability`). */
  has_availability: boolean;
}

/** Facts of the stay from already-read data. Pure. */
export function buildStayFacts(
  defaults: PolicyDefaults,
  depositPercent: unknown,
  rooms: { max_occupancy: number; images: string[] | null }[],
): BookingStayFacts {
  const deposit = Number(depositPercent);
  const capacity = rooms.reduce((max, r) => Math.max(max, Number(r.max_occupancy) || 0), 0);
  return {
    check_in: defaults.check_in || null,
    check_out: defaults.check_out || null,
    cancellation: defaults.cancellation || null,
    max_guests: capacity > 0 ? capacity : null,
    deposit_percent: Number.isFinite(deposit) && deposit > 0 ? deposit : null,
    has_photos: rooms.some((r) => (r.images ?? []).length > 0),
    has_availability: rooms.length > 0,
  };
}

/**
 * Whether the public page needs the stay facts: an enabled `stay_detail`
 * block, or any block shown under conditions. A page without them keeps its
 * response (and its queries) as before.
 */
export function needsStayFacts(page: AppPageDocument): boolean {
  return page.blocks.some(
    (b) =>
      (b.type === 'stay_detail' && b.enabled) ||
      (!!b.props?.['visible_when'] && typeof b.props['visible_when'] === 'object'),
  );
}

/** Fills the empty texts of the policies block; saved texts are kept. Pure. */
export function fillPolicies(page: AppPageDocument, defaults: PolicyDefaults): AppPageDocument {
  if (!page.blocks.some(needsFill)) return page;
  return {
    ...page,
    blocks: page.blocks.map((block) => {
      if (!needsFill(block)) return block;
      const props = { ...block.props };
      for (const key of POLICY_KEYS) {
        const value = defaults[key];
        if (isBlank(props[key]) && value) props[key] = value;
      }
      return { ...block, props };
    }),
  };
}

/**
 * The public booking page shows the hotel's real rules: check-in/out times from
 * the store settings and the cancellation policy of the default rate plan,
 * only where the owner left the text empty. Every read filters by `storeId`.
 */
@Injectable()
export class BookingPoliciesService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async fill(storeId: number, page: AppPageDocument): Promise<AppPageDocument> {
    if (!page.blocks.some(needsFill)) return page;
    return fillPolicies(page, await this.defaults(storeId));
  }

  /** The hotel's real policy texts; the editor preview fills its draft with them too. */
  async defaults(storeId: number): Promise<PolicyDefaults> {
    return (await this.read(storeId)).defaults;
  }

  /** Real data of the stay (`stay_detail` and `visible_when`), scoped by `storeId`. */
  async stayFacts(storeId: number): Promise<BookingStayFacts> {
    const [{ defaults, depositPercent }, rooms] = await Promise.all([
      this.read(storeId),
      this.prisma.lodging_unit_types.findMany({
        where: { store_id: storeId, is_active: true },
        select: { max_occupancy: true, images: true },
      }),
    ]);
    return buildStayFacts(defaults, depositPercent, rooms);
  }

  private async read(storeId: number): Promise<{ defaults: PolicyDefaults; depositPercent: unknown }> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });
    const hospitality = (mergeStoreSettingsWithDefaults(row?.settings)?.hospitality ?? {}) as {
      check_in_time?: string;
      check_out_time?: string;
    };
    const plan = await this.prisma.lodging_rate_plans.findFirst({
      where: { store_id: storeId, is_default: true, is_active: true },
      select: {
        deposit_percent: true,
        cancellation_policy: {
          select: { id: true, name: true, rules: true, no_show_penalty: true, is_active: true },
        },
      },
    });
    const policy = plan?.cancellation_policy?.is_active ? toPolicySnapshot(plan.cancellation_policy) : null;
    return {
      defaults: {
        check_in: formatCheckIn(hospitality.check_in_time || '15:00'),
        check_out: formatCheckOut(hospitality.check_out_time || '12:00'),
        cancellation: policyText(asPolicySnapshot(policy)),
      },
      depositPercent: plan?.deposit_percent ?? null,
    };
  }
}
