/**
 * Image Processing Presets
 *
 * Configurable compression profiles per upload context.
 * Each preset defines dimensions, quality, and thumbnail settings
 * tuned to actual frontend display sizes.
 */

export enum ImageContext {
  SLIDER = 'slider',
  PRODUCT = 'product',
  AVATAR = 'avatar',
  LOGO = 'logo',
  // [print-fiscal-gate P6] — preset dedicado al logo en impresión térmica.
  // No downscale agresivo (la térmica imprime en 203/300 dpi nativos sobre
  // 80mm de ancho: ~8 píxeles/mm a 203 dpi) y exige monocromo porque las
  // impresoras térmicas de recibo NO reproducen color. Sin esta distinción,
  // el logo subía por el preset LOGO (maxWidth 400, calidad 90) y la térmica
  // lo recibía suavizado y en gris continuo, que en una Epson TM-T20 sale
  // como mancha gris en vez de marca.
  LOGO_PRINT = 'logo-print',
  CATEGORY = 'category',
  MARKETING_AD = 'marketing_ad',
  RECEIPT = 'receipt',
  HELP_CENTER = 'help_center',
  SUPPORT = 'support',
  DEFAULT = 'default',
}

export interface ImageThumbnailPreset {
  width: number;
  height: number;
  quality: number;
  fit: 'inside' | 'cover' | 'contain';
}

export interface ImagePreset {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  fit: 'inside' | 'cover' | 'contain';
  thumbnail?: ImageThumbnailPreset;
  skipIfAlreadyOptimized?: boolean;
}

export const IMAGE_PRESETS: Record<ImageContext, ImagePreset> = {
  [ImageContext.SLIDER]: {
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 85,
    fit: 'inside',
    thumbnail: { width: 400, height: 225, quality: 75, fit: 'cover' },
    skipIfAlreadyOptimized: true,
  },
  [ImageContext.PRODUCT]: {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 85,
    fit: 'inside',
    thumbnail: { width: 300, height: 300, quality: 75, fit: 'cover' },
  },
  [ImageContext.AVATAR]: {
    maxWidth: 256,
    maxHeight: 256,
    quality: 80,
    fit: 'cover',
  },
  [ImageContext.LOGO]: {
    maxWidth: 400,
    maxHeight: 200,
    quality: 90,
    fit: 'inside',
    skipIfAlreadyOptimized: true,
  },
  // [print-fiscal-gate P6] — ver comentario en ImageContext.LOGO_PRINT.
  // Sin `maxWidth` agresivo (la térmica usa ancho nativo del papel) y con
  // monocromo activado para que la conversión la haga el upload pipeline.
  [ImageContext.LOGO_PRINT]: {
    maxWidth: 1600,
    maxHeight: 800,
    quality: 100,
    fit: 'inside',
    skipIfAlreadyOptimized: false,
  },
  [ImageContext.CATEGORY]: {
    maxWidth: 800,
    maxHeight: 800,
    quality: 82,
    fit: 'inside',
    thumbnail: { width: 200, height: 200, quality: 72, fit: 'cover' },
  },
  [ImageContext.MARKETING_AD]: {
    maxWidth: 1536,
    maxHeight: 1536,
    quality: 88,
    fit: 'inside',
    thumbnail: { width: 360, height: 360, quality: 76, fit: 'cover' },
    skipIfAlreadyOptimized: true,
  },
  [ImageContext.RECEIPT]: {
    maxWidth: 1200,
    maxHeight: 1600,
    quality: 88,
    fit: 'inside',
    skipIfAlreadyOptimized: true,
  },
  [ImageContext.HELP_CENTER]: {
    maxWidth: 1200,
    maxHeight: 800,
    quality: 82,
    fit: 'inside',
    skipIfAlreadyOptimized: true,
    thumbnail: {
      width: 400,
      height: 267,
      quality: 75,
      fit: 'cover',
    },
  },
  [ImageContext.SUPPORT]: {
    maxWidth: 1200,
    maxHeight: 1200,
    quality: 80,
    fit: 'inside',
    thumbnail: { width: 200, height: 200, quality: 70, fit: 'cover' },
  },
  [ImageContext.DEFAULT]: {
    maxWidth: 1000,
    maxHeight: 1000,
    quality: 80,
    fit: 'inside',
    thumbnail: { width: 200, height: 200, quality: 70, fit: 'cover' },
  },
};

/**
 * PWA Icon Derivation
 *
 * The installed app (Android/iOS/desktop) cannot consume the tenant logo
 * directly: it requires square, opaque PNGs in fixed sizes. These variants are
 * derived from the tenant logo and cached in S3.
 */
export type PwaIconVariant =
  | 'icon-192'
  | 'icon-512'
  | 'icon-maskable-512'
  | 'apple-touch-icon-180';

export interface PwaIconSpec {
  /** lado del PNG cuadrado resultante, en px */
  size: number;
  /** fracción del lienzo que ocupa el logo inscrito (1 = borde a borde) */
  inscribeRatio: number;
}

/**
 * All variants are rendered as square, OPAQUE PNGs (no alpha channel):
 * Safari paints transparency as black, and Android masks adaptive icons.
 *
 * - `icon-192`             Android / Chromium install prompt.
 * - `icon-512`             Android splash, Windows/Edge taskbar.
 * - `icon-maskable-512`    Android adaptive icon: the logo is inscribed at 60%
 *                          so it survives the 20%-per-side safe-zone crop.
 * - `apple-touch-icon-180` iOS/iPadOS/macOS Safari home-screen icon.
 */
/**
 * Shortest side, in pixels, a tenant asset must have to be worth deriving an
 * app icon from.
 *
 * The install icon is rendered at up to 512px. Upscaling a 16x16 favicon into
 * that canvas produces an unreadable smear that reads as a broken brand, so a
 * source below this floor is rejected and the tenant installs with the Vendix
 * mark instead — a deliberate trade: a correct foreign logo beats an illegible
 * own one.
 */
export const MIN_PWA_SOURCE_PX = 64;

export const PWA_ICON_SPECS: Record<PwaIconVariant, PwaIconSpec> = {
  'icon-192': { size: 192, inscribeRatio: 1 },
  'icon-512': { size: 512, inscribeRatio: 1 },
  'icon-maskable-512': { size: 512, inscribeRatio: 0.6 },
  'apple-touch-icon-180': { size: 180, inscribeRatio: 1 },
};

/** Every supported PWA icon variant, useful to build manifest entries. */
export const PWA_ICON_VARIANTS = Object.keys(
  PWA_ICON_SPECS,
) as PwaIconVariant[];

/**
 * Narrows an untrusted string (e.g. a route param) to a supported variant.
 */
export function isPwaIconVariant(
  value: string | null | undefined,
): value is PwaIconVariant {
  return !!value && Object.prototype.hasOwnProperty.call(PWA_ICON_SPECS, value);
}
