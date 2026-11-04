import type { AppPageFont } from '../../private/modules/store/apps/templates/app-page.types';

/** A list item of a block: every value read as text. */
export type BlockItem = Record<string, string>;

const FONT_STACKS: Record<AppPageFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  poppins: 'Poppins, "Segoe UI", system-ui, -apple-system, sans-serif',
  playfair: '"Playfair Display", Georgia, "Times New Roman", serif',
  montserrat: 'Montserrat, "Segoe UI", system-ui, -apple-system, sans-serif',
  lora: 'Lora, Georgia, "Times New Roman", serif',
};

/** Font stack of a brand font (system and generic fallbacks, no font loading). */
export function fontStack(font: string | undefined): string | null {
  return font && font in FONT_STACKS ? FONT_STACKS[font as AppPageFont] : null;
}

/** Only `#rrggbb` colors reach a style binding. */
export function safeColor(value: string | undefined): string | null {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

/** Only absolute http(s) URLs reach an `href` or `src`. */
export function safeUrl(value: string | undefined): string | null {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

export function blockText(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function blockItems(props: Record<string, unknown>, key = 'items'): BlockItem[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const out: BlockItem = {};
      for (const [k, v] of Object.entries(item)) {
        if (typeof v === 'string') out[k] = v.trim();
        else if (typeof v === 'number') out[k] = String(v);
      }
      return out;
    });
}

export function blockStrings(props: Record<string, unknown>, key: string): string[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Rating of a testimonial clamped to 0-5 whole stars. */
export function ratingOf(item: BlockItem): number {
  const n = Math.round(Number(item['rating']));
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

export const STAR_SLOTS = [1, 2, 3, 4, 5] as const;

/**
 * F6-B — `wa.me` link of a WhatsApp number (digits with country code; spaces,
 * dashes and parentheses ignored) and its first message; `null` without a
 * valid number.
 */
export function whatsappHref(number: string | undefined, message?: string): string | null {
  const digits = (number ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const text = (message ?? '').trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
