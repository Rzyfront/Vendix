import type {
  AppPageDocument,
  AppPageTheme,
  AppThemeCardStyle,
  AppThemeContentWidth,
  AppThemeDensity,
  AppThemeFontSize,
  AppThemeHeadingScale,
  AppThemeHeroHeight,
  AppThemeImageRatio,
  AppThemeRadius,
  AppThemeSectionGap,
  AppThemeShadow,
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

// ---- Apps F7: extended tokens ------------------------------------------------
// Every value below is only bound when its token is set; the CSS rules that
// read them fall back to today's value (scale 1, square gallery, no veil…).

/** Multiplier of the body text sizes. `md` is today's size. */
const FONT_SCALE: Record<AppThemeFontSize, string> = { sm: '0.9375', md: '1', lg: '1.0625' };

/** Multiplier of the heading sizes (on top of the body one). `normal` is today's size. */
const HEADING_SCALE: Record<AppThemeHeadingScale, string> = { compact: '0.85', normal: '1', display: '1.25' };

/** Multiplier of the vertical padding of each section. `normal` is today's spacing. */
const SECTION_GAP: Record<AppThemeSectionGap, string> = { tight: '0.6', normal: '1', airy: '1.5' };

const SHADOW: Record<AppThemeShadow, string> = {
  none: 'none',
  soft: '0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.06)',
  strong: '0 4px 8px rgba(15, 23, 42, 0.08), 0 16px 32px rgba(15, 23, 42, 0.16)',
};

/** CSS `aspect-ratio` of gallery and hero images. `auto` keeps each image's own shape. */
const IMAGE_RATIO: Record<AppThemeImageRatio, string> = {
  square: '1 / 1',
  '4:3': '4 / 3',
  '16:9': '16 / 9',
  auto: 'auto',
};

/** Vertical padding of the hero (mobile / desktop). `auto` is today's (py-12 / md:py-16). */
const HERO_PADDING: Record<AppThemeHeroHeight, { py: string; pyMd: string }> = {
  auto: { py: '3rem', pyMd: '4rem' },
  compact: { py: '2rem', pyMd: '2.5rem' },
  full: { py: '3rem', pyMd: '4rem' },
};

/** A border closer than this to the background (WCAG ratio) is hard to see. */
export const MIN_BORDER_CONTRAST = 1.15;

/** Max opacity (%) of the image veil, as in the contract. */
const MAX_IMAGE_OVERLAY = 80;

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

  // Apps F7 — extended tokens.
  const border = safeColor(t.border_color);
  if (border) {
    set('--ap-border', border);
    set('--color-border', border);
  }
  if (t.base_font_size && t.base_font_size in FONT_SCALE) set('--ap-font-scale', FONT_SCALE[t.base_font_size]);
  if (t.heading_scale && t.heading_scale in HEADING_SCALE) set('--ap-heading-scale', HEADING_SCALE[t.heading_scale]);
  if (t.section_gap && t.section_gap in SECTION_GAP) set('--ap-section-gap', SECTION_GAP[t.section_gap]);
  if (t.shadow && t.shadow in SHADOW) set('--ap-card-shadow', SHADOW[t.shadow]);
  if (t.image_ratio && t.image_ratio in IMAGE_RATIO) set('--ap-image-ratio', IMAGE_RATIO[t.image_ratio]);
  const overlay = imageOverlay(t);
  if (overlay !== null) {
    set('--ap-image-overlay', String(overlay / 100));
    set('--ap-image-brightness', String(Math.round((1 - overlay / 100) * 100) / 100));
  }
  if (t.hero_height && t.hero_height in HERO_PADDING) {
    set('--ap-hero-py', HERO_PADDING[t.hero_height].py);
    set('--ap-hero-py-md', HERO_PADDING[t.hero_height].pyMd);
  }
  return vars;
}

/** The image veil (0..80 %), or `null` when the theme does not set a valid one. */
function imageOverlay(theme: AppPageTheme): number | null {
  const value = theme.image_overlay;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_IMAGE_OVERLAY
    ? value
    : null;
}

/**
 * Apps F7 — markers of the page container (as `data-*` attributes) that turn
 * on the rules without a neutral fallback: typography, card style, shadow,
 * image veil and hero height. `null` = the attribute is not bound, so a page
 * without these tokens keeps exactly its current rules.
 */
export interface ThemeMarkers {
  type: '' | null;
  card: AppThemeCardStyle | null;
  shadow: '' | null;
  overlay: '' | null;
  hero: AppThemeHeroHeight | null;
}

export function themeMarkers(page: AppPageDocument | null | undefined): ThemeMarkers {
  const t = page?.theme ?? {};
  const card = t.card_style === 'flat' || t.card_style === 'outline' || t.card_style === 'soft' ? t.card_style : null;
  const hero = t.hero_height === 'auto' || t.hero_height === 'compact' || t.hero_height === 'full' ? t.hero_height : null;
  return {
    type: (t.base_font_size && t.base_font_size in FONT_SCALE) || (t.heading_scale && t.heading_scale in HEADING_SCALE) ? '' : null,
    card,
    shadow: t.shadow && t.shadow in SHADOW ? '' : null,
    overlay: imageOverlay(t) !== null ? '' : null,
    hero,
  };
}

/**
 * Apps F7 — contrast of the border color against the background. `null`
 * when the theme sets no (valid) border color.
 */
export function borderContrast(theme: AppPageTheme | undefined): { ratio: number; ok: boolean } | null {
  const border = safeColor(theme?.border_color);
  if (!border) return null;
  const surface = safeColor(theme?.surface_color) ?? DEFAULT_SURFACE;
  const ratio = Math.round(contrastRatio(border, surface) * 100) / 100;
  return { ratio, ok: ratio >= MIN_BORDER_CONTRAST };
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
