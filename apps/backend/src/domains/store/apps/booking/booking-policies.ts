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
        cancellation_policy: {
          select: { id: true, name: true, rules: true, no_show_penalty: true, is_active: true },
        },
      },
    });
    const policy = plan?.cancellation_policy?.is_active ? toPolicySnapshot(plan.cancellation_policy) : null;
    return fillPolicies(page, {
      check_in: formatCheckIn(hospitality.check_in_time || '15:00'),
      check_out: formatCheckOut(hospitality.check_out_time || '12:00'),
      cancellation: policyText(asPolicySnapshot(policy)),
    });
  }
}
