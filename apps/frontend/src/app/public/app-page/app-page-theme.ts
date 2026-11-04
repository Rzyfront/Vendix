import type {
  AppPageDocument,
  AppPageTheme,
  AppThemeContentWidth,
  AppThemeDensity,
  AppThemeRadius,
} from '../../private/modules/store/apps/templates/app-page.types';
import { fontStack, safeColor } from './app-page-view.util';

/**
 * Apps F3 — turns `page.theme` into CSS custom properties scoped to the page
 * container (`AppPageViewComponent` host). Only the tokens the theme defines
 * produce a property; every rule that reads one falls back to today's value,
 * so a page without `theme` (or with a partial one) keeps its pre-F3 look.
 *
 * Colors also override the Tailwind tokens the blocks already use
 * (`bg-surface`, `text-text-primary`, `text-text-secondary`, `border-border`),
 * so the blocks pick the palette up without a second set of classes.
 */

const DEFAULT_SURFACE = '#ffffff';
const DEFAULT_TEXT = '#111827';
const DARK_ON_COLOR = '#111827';
const LIGHT_ON_COLOR = '#ffffff';

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;

const RADIUS: Record<AppThemeRadius, { card: string; button: string; image: string }> = {
  none: { card: '0', button: '0', image: '0.5rem' },
  small: { card: '0.5rem', button: '0.375rem', image: '0.5rem' },
  medium: { card: '1rem', button: '0.75rem', image: '0.75rem' },
  large: { card: '1.75rem', button: '9999px', image: '1.5rem' },
};

const DENSITY: Record<AppThemeDensity, { py: string; pyMd: string; card: string; gap: string }> = {
  compact: { py: '1.25rem', pyMd: '1.75rem', card: '1rem', gap: '0.75rem' },
  comfortable: { py: '2rem', pyMd: '2.5rem', card: '1.25rem', gap: '1rem' },
  spacious: { py: '3rem', pyMd: '4.5rem', card: '1.75rem', gap: '1.5rem' },
};

const WIDTH: Record<AppThemeContentWidth, string> = {
  narrow: '56rem',
  normal: '72rem',
  wide: '84rem',
};

// ---- color math (WCAG 2.x) ---------------------------------------------------

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

/** `r, g, b` for the Tailwind `--color-*-rgb` tokens. */
function rgbList(hex: string): string {
  return channels(hex).join(', ');
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `weight` of `a` mixed with `1 - weight` of `b`, like `color-mix(in srgb, …)`. */
export function mixColors(a: string, b: string, weight: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return toHex([0, 1, 2].map((i) => ca[i] * weight + cb[i] * (1 - weight)) as [number, number, number]);
}

/** White or near-black, whichever reads better on `background`. */
export function onColor(background: string): string {
  return contrastRatio(LIGHT_ON_COLOR, background) >= contrastRatio(DARK_ON_COLOR, background)
    ? LIGHT_ON_COLOR
    : DARK_ON_COLOR;
}

// ---- resolved palette ------------------------------------------------------------

/** The concrete colors a theme paints with (derived ones included). */
export interface ThemePalette {
  primary: string | null;
  onPrimary: string | null;
  secondary: string | null;
  accent: string | null;
  /** Page background, cards, borders and text: `null` when the theme sets neither surface nor text. */
  surface: string | null;
  card: string | null;
  border: string | null;
  text: string | null;
  muted: string | null;
}

export function themePalette(theme: AppPageTheme | undefined, brand?: AppPageDocument['brand']): ThemePalette {
  const t = theme ?? {};
  const primary = safeColor(t.primary_color) ?? safeColor(brand?.primary_color);
  const ownSurface = safeColor(t.surface_color);
  const ownText = safeColor(t.text_color);
  const painted = !!(ownSurface || ownText);
  const surface = ownSurface ?? DEFAULT_SURFACE;
  const text = ownText ?? DEFAULT_TEXT;
  return {
    primary,
    // Text on the primary is chosen only when the theme sets the primary;
    // otherwise it stays white, as before F3.
    onPrimary: safeColor(t.primary_color) ? onColor(safeColor(t.primary_color)!) : null,
    secondary: safeColor(t.secondary_color) ?? safeColor(brand?.secondary_color),
    accent: safeColor(t.accent_color),
    surface: painted ? surface : null,
    card: painted ? mixColors(text, surface, 0.035) : null,
    border: painted ? mixColors(text, surface, 0.14) : null,
    text: painted ? text : null,
    muted: painted ? mixColors(text, surface, 0.78) : null,
  };
}

/** Whether a page carries at least one style token. */
export function hasTheme(page: AppPageDocument | null | undefined): boolean {
  return !!page?.theme && Object.keys(page.theme).length > 0;
}

/**
 * CSS custom properties of the page container. `null` without theme: the
 * container then binds nothing new and renders exactly as before F3.
 */
export function themeStyle(page: AppPageDocument | null | undefined): Record<string, string> | null {
  if (!page || !hasTheme(page)) return null;
  const t = page.theme ?? {};
  const p = themePalette(t, page.brand);
  const vars: Record<string, string> = {};
  const set = (key: string, value: string | null | undefined) => {
    if (value) vars[key] = value;
  };

  set('--ap-on-primary', p.onPrimary);
  set('--ap-accent', p.accent);
  if (p.surface && p.text && p.card && p.border && p.muted) {
    set('--ap-surface', p.surface);
    set('--ap-text', p.text);
    set('--color-surface-rgb', rgbList(p.card));
    set('--color-text-primary-rgb', rgbList(p.text));
    set('--color-text-secondary-rgb', rgbList(p.muted));
    set('--color-border', p.border);
  }
  set('--ap-heading-font', fontStack(t.heading_font));
  set('--ap-body-font', fontStack(t.body_font));
  if (t.radius && t.radius in RADIUS) {
    const r = RADIUS[t.radius];
    set('--ap-radius-card', r.card);
    set('--ap-radius-button', r.button);
  }
  if (t.image_style === 'square') set('--ap-radius-image', '0');
  else if (t.image_style === 'rounded') {
    set('--ap-radius-image', t.radius && t.radius in RADIUS ? RADIUS[t.radius].image : '1rem');
  }
  if (t.density && t.density in DENSITY) {
    const d = DENSITY[t.density];
    set('--ap-section-py', d.py);
    set('--ap-section-py-md', d.pyMd);
    set('--ap-card-padding', d.card);
    set('--ap-gap', d.gap);
  }
  if (t.content_width && t.content_width in WIDTH) set('--ap-max-width', WIDTH[t.content_width]);
  return vars;
}

/** One readability check of a theme, for the editor and the preset specs. */
export interface ContrastCheck {
  id: 'text' | 'muted' | 'button' | 'outline' | 'accent' | 'hero';
  label: string;
  ratio: number;
  ok: boolean;
}

/**
 * Readability of a theme with WCAG AA (4.5:1): text and secondary text on
 * their cards, text on the solid button, the outline button and the accent on
 * the background, and the hero text on the secondary end of its gradient.
 * Only the pairs the theme actually paints are checked.
 */
export function contrastChecks(theme: AppPageTheme | undefined, brand?: AppPageDocument['brand']): ContrastCheck[] {
  const p = themePalette(theme, brand);
  const surface = p.surface ?? DEFAULT_SURFACE;
  const card = p.card ?? surface;
  const checks: ContrastCheck[] = [];
  const add = (id: ContrastCheck['id'], label: string, a: string, b: string) => {
    const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
    checks.push({ id, label, ratio, ok: ratio >= MIN_TEXT_CONTRAST });
  };
  if (p.text && p.muted) {
    add('text', 'Texto sobre el fondo', p.text, card);
    add('muted', 'Texto secundario', p.muted, card);
  }
  if (p.primary && p.onPrimary) {
    add('button', 'Texto del botón', p.onPrimary, p.primary);
    if (p.secondary) add('hero', 'Portada sin imagen (texto sobre el secundario)', p.onPrimary, p.secondary);
  }
  if (p.primary && theme?.button_style === 'outline') {
    add('outline', 'Botón de contorno sobre el fondo', p.primary, surface);
  }
  if (p.accent) add('accent', 'Acento sobre el fondo', p.accent, surface);
  return checks;
}
