import { Injectable } from '@nestjs/common';

/**
 * Branding Configuration Interface
 *
 * Standardized format for branding configuration across all domains.
 * This matches the format expected by the frontend ThemeService.
 */
export interface BrandingConfig {
  name: string;
  theme: 'light' | 'dark';
  logo_url?: string;
  favicon_url?: string;
  text_color: string;
  accent_color: string;
  border_color?: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  surface_color?: string;
  text_secondary_color?: string;
  text_muted_color?: string;
}

/**
 * Color Palette Interface
 *
 * Generated palette from primary and secondary colors
 */
export interface ColorPalette {
  primary: string;
  secondary: string;
  primaryLight: string;
  primaryDark: string;
  secondaryLight: string;
  secondaryDark: string;
  accent: string;
  background: string;
  text: string;
  border: string;
}

/**
 * Branding Generator Helper
 *
 * Centralized service for generating consistent branding configurations
 * across all domain creation flows (onboarding, stores, organizations).
 *
 * @example
 * ```typescript
 * const branding = brandingGenerator.generateBranding({
 *   name: 'My Store',
 *   primaryColor: '#7ED7A5',
 *   secondaryColor: '#2F6F4E',
 *   theme: 'light',
 * });
 * ```
 */
@Injectable()
export class BrandingGeneratorHelper {
  /**
   * Default branding colors (Vendix defaults)
   */
  private readonly DEFAULT_BRANDING = {
    primary_color: '#7ED7A5',
    secondary_color: '#2F6F4E',
    background_color: '#F4F4F4',
    surface_color: '#FFFFFF',
    text_color: '#222222',
    accent_color: '#FFFFFF',
    border_color: '#E5E7EB',
    text_secondary_color: '#555555',
    text_muted_color: '#AAAAAA',
  };

  /**
   * Generate complete branding configuration
   *
   * @param options - Branding options
   * @returns Complete branding config in standard format
   */
  generateBranding(options: {
    name: string;
    primaryColor: string;
    secondaryColor: string;
    theme?: 'light' | 'dark';
    logoUrl?: string;
    faviconUrl?: string;
    backgroundColor?: string;
    surfaceColor?: string;
    accentColor?: string;
  }): BrandingConfig {
    const {
      name,
      primaryColor,
      secondaryColor,
      theme = 'light',
      logoUrl,
      faviconUrl,
    } = options;

    // Validate and normalize colors
    const normalizedPrimary = this.normalizeColor(primaryColor);
    const normalizedSecondary = this.normalizeColor(secondaryColor);

    // Generate palette from primary and secondary
    const palette = this.generateColorPalette(
      normalizedPrimary,
      normalizedSecondary,
    );

    return {
      name,
      theme,
      logo_url: logoUrl || undefined,
      favicon_url: faviconUrl || undefined,
      // Use snake_case format for API consistency
      primary_color: palette.primary,
      secondary_color: palette.secondary,
      background_color: options.backgroundColor || this.DEFAULT_BRANDING.background_color,
      surface_color: options.surfaceColor || this.DEFAULT_BRANDING.surface_color,
      text_color: palette.text,
      accent_color: options.accentColor || this.DEFAULT_BRANDING.accent_color,
      border_color: palette.border,
      text_secondary_color: palette.text, // Could be adjusted to be lighter
      text_muted_color: this.lightenColor(palette.text, 40),
    };
  }

  /**
   * Generate branding config with palette (for onboarding wizard)
   *
   * @param options - Branding options
   * @returns Complete branding config with palette
   */
  generateBrandingWithPalette(options: {
    name: string;
    primaryColor: string;
    secondaryColor: string;
    theme?: 'light' | 'dark';
    logoUrl?: string;
    faviconUrl?: string;
  }): {
    branding: BrandingConfig;
    palette: ColorPalette;
  } {
    const branding = this.generateBranding(options);
    const palette = this.generateColorPalette(
      branding.primary_color,
      branding.secondary_color,
    );

    return { branding, palette };
  }

  /**
   * Generate color palette from primary and secondary colors
   *
   * @param primary - Primary color in hex format
   * @param secondary - Secondary color in hex format
   * @returns Complete color palette
   */
  generateColorPalette(
    primary: string,
    secondary: string,
  ): ColorPalette {
    return {
      primary,
      secondary,
      primaryLight: this.lightenColor(primary, 20),
      primaryDark: this.darkenColor(primary, 20),
      secondaryLight: this.lightenColor(secondary, 20),
      secondaryDark: this.darkenColor(secondary, 20),
      accent: this.generateAccentColor(primary, secondary),
      background: '#FFFFFF',
      text: '#1F2937',
      border: '#E5E7EB',
    };
  }

  /**
   * Normalize color to hex format
   * Ensures proper hex format with # prefix and uppercase
   *
   * @param color - Color in any format
   * @returns Normalized hex color
   */
  normalizeColor(color: string): string {
    if (!color) {
      return this.DEFAULT_BRANDING.primary_color;
    }

    // Remove whitespace
    const normalized = color.trim().toUpperCase();

    // Add # if missing
    if (!normalized.startsWith('#')) {
      return `#${normalized}`;
    }

    return normalized;
  }

  /**
   * Lighten a hex color by a percentage
   *
   * @param color - Hex color (e.g., "#7ED7A5")
   * @param percent - Percentage to lighten (0-100)
   * @returns Lightened hex color
   */
  lightenColor(color: string, percent: number): string {
    const normalized = this.normalizeColor(color);
    const num = parseInt(normalized.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;

    return `#${(
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
      .toUpperCase()}`;
  }

  /**
   * Darken a hex color by a percentage
   *
   * @param color - Hex color (e.g., "#7ED7A5")
   * @param percent - Percentage to darken (0-100)
   * @returns Darkened hex color
   */
  darkenColor(color: string, percent: number): string {
    const normalized = this.normalizeColor(color);
    const num = parseInt(normalized.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = ((num >> 8) & 0x00ff) - amt;
    const B = (num & 0x0000ff) - amt;

    return `#${(
      0x1000000 +
      (R > 0 ? R : 0) * 0x10000 +
      (G > 0 ? G : 0) * 0x100 +
      (B > 0 ? B : 0)
    )
      .toString(16)
      .slice(1)
      .toUpperCase()}`;
  }

  /**
   * Generate accent color from primary and secondary
   * Uses a blend of both colors for a harmonious accent
   *
   * @param primary - Primary hex color
   * @param secondary - Secondary hex color
   * @returns Generated accent color
   */
  generateAccentColor(primary: string, secondary: string): string {
    // Simple blend - use secondary as accent
    // In production, you might want a more sophisticated algorithm
    return this.normalizeColor(secondary);
  }

  /**
   * Validate hex color format
   *
   * @param color - Color to validate
   * @returns True if valid hex color
   */
  isValidHexColor(color: string): boolean {
    const hexRegex = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexRegex.test(color.trim());
  }

  /**
   * Get default branding configuration
   *
   * @returns Default branding config
   */
  getDefaultBranding(name: string = 'Vendix Corp'): BrandingConfig {
    return {
      name,
      theme: 'light',
      logo_url: undefined,
      favicon_url: undefined,
      ...this.DEFAULT_BRANDING,
    };
  }
}
