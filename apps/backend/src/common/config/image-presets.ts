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
  CATEGORY = 'category',
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
  [ImageContext.CATEGORY]: {
    maxWidth: 800,
    maxHeight: 800,
    quality: 82,
    fit: 'inside',
    thumbnail: { width: 200, height: 200, quality: 72, fit: 'cover' },
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
