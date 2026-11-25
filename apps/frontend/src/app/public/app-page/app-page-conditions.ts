import {
  APP_BLOCK_CONDITION_KEYS,
  AppBlockConditionKey,
} from '../../private/modules/store/apps/templates/app-page.types';

/**
 * Apps booking-detail — the real data a block condition (`props.visible_when`)
 * is checked against. Every app view computes it from the same data in the
 * editor preview and on the published page, so both show the same blocks.
 * `null` = the datum is unknown (the condition is not applied).
 */
export interface AppPageFacts {
  has_photos: boolean | null;
  has_availability: boolean | null;
  sells: boolean;
}

/**
 * Whether a block shows: every condition it sets must match the page's data.
 * No `visible_when` (or no facts) = always shown, as before.
 */
export function blockConditionsMet(
  props: Record<string, unknown> | null | undefined,
  facts: AppPageFacts | null,
): boolean {
  const raw = props?.['visible_when'];
  if (!facts || !raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const conditions = raw as Partial<Record<AppBlockConditionKey, unknown>>;
  return APP_BLOCK_CONDITION_KEYS.every((key) => {
    const expected = conditions[key];
    if (typeof expected !== 'boolean') return true;
    const actual = facts[key];
    return actual === null || actual === expected;
  });
}

/** Facts of a service page from the services it lists (catalog on the public page, server read in the preview). */
export function servicePageFacts(
  services: readonly { image_url?: string | null; requires_booking?: boolean | null; is_plan?: boolean | null }[],
  sells: boolean,
): AppPageFacts {
  return {
    has_photos: services.some((s) => !!s.image_url),
    has_availability: services.some((s) => !!s.requires_booking && !s.is_plan),
    sells,
  };
}
