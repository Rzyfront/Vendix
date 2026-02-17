import { Injectable, Inject, DOCUMENT } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BrandingConfig, ThemeConfig } from '../models/tenant-config.interface';
import { AppConfig } from './app-config.service';
import { ColorUtils } from '../utils/color.utils';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private currentThemeSubject = new BehaviorSubject<ThemeConfig | null>(null);
  public currentTheme$ = this.currentThemeSubject.asObservable();

  private loadedFonts = new Set<string>();
  private injectedStyleElements = new Map<string, HTMLStyleElement>();
  private currentBranding: BrandingConfig | null = null;
  private activeUserTheme: string = 'default';

  constructor(@Inject(DOCUMENT) private document: Document) { }

  /**
   * Aplica un ajuste preestablecido de tema (preset)
   */
  /**
   * Aplica un tema basado en preferencia de usuario (default, aura, monocromo)
   * Usa el branding actual como base para calcular los colores.
   */
  async applyUserTheme(theme: 'default' | 'aura' | 'monocromo' | string): Promise<void> {
    this.activeUserTheme = theme;
    const root = this.document.documentElement;
    const body = this.document.body;

    // Obtener colores base del branding actual (o defaults si falta)
    const basePrimary = this.currentBranding?.colors?.primary || 
                        getComputedStyle(root).getPropertyValue('--color-primary').trim() || 
                        '#3b82f6';
    
    const baseSurface = this.currentBranding?.colors?.surface || 
                        getComputedStyle(root).getPropertyValue('--color-surface').trim() || 
                        '#ffffff';

    const baseBackground = this.currentBranding?.colors?.background || 
                           getComputedStyle(root).getPropertyValue('--color-background').trim() || 
                           '#f4f4f4';

    // Limpiar estilos previos del body (gradientes, etc) que ya no se piden
    body.style.removeProperty('background-image');
    body.style.removeProperty('background-attachment');
    this.resetThemeOverrides();

    // Restaurar base antes de aplicar overrides
    if (!this.currentBranding) {
         root.style.setProperty('--color-primary', basePrimary);
         root.style.setProperty('--color-surface', baseSurface);
         root.style.setProperty('--color-background', baseBackground);
    } else if (this.currentBranding.colors) {
         this.setCssVariables({
             '--color-primary': this.currentBranding.colors.primary,
             '--color-secondary': this.currentBranding.colors.secondary,
             '--color-accent': this.currentBranding.colors.accent,
             '--color-background': this.currentBranding.colors.background,
             '--color-surface': this.currentBranding.colors.surface,
             '--color-text-primary': this.currentBranding.colors.text?.primary,
             '--color-text-secondary': this.currentBranding.colors.text?.secondary,
             '--color-text-muted': this.currentBranding.colors.text?.muted,
             // RGB versions
             '--color-primary-rgb': this.hexToRgbString(this.currentBranding.colors.primary),
             '--color-secondary-rgb': this.hexToRgbString(this.currentBranding.colors.secondary),
             '--color-accent-rgb': this.hexToRgbString(this.currentBranding.colors.accent),
             '--color-background-rgb': this.hexToRgbString(this.currentBranding.colors.background),
             '--color-surface-rgb': this.hexToRgbString(this.currentBranding.colors.surface),
         });
    }

    let overrides: { [key: string]: string | undefined } = {};

    switch (theme) {
      case 'aura':
        // Aura: Recalcular --color-surface
        // 90% color original del surface y 10% del primary_color
        // mixColors(color1, color2, weight) -> weight es peso de color2
        // color1: Primary, color2: BaseSurface. Weight: 0.90 (90% BaseSurface)
        const auraSurface = ColorUtils.mixColors(basePrimary, baseSurface, 0.90);
        
        overrides = {
          '--color-surface': auraSurface
          // Background se queda como el original (no transparente)
        };
        break;

      case 'monocromo':
        // Monocromo: Relación de color respecto al primary
        // Surface más claro (98% blanco/base), Background un poco más oscurito (94% blanco/base)
        // Usamos baseSurface/baseBackground como referencia de "Blanco" o lo forzamos a blanco?
        // El requerimiento dice: "parecida a la relación actual... surface es mas claro y background mas oscurito"
        // Asumimos mezcla con blanco para garantizar limpieza, igual que la implementación previa aprobada.
        
        const monoSurface = ColorUtils.mixColors(basePrimary, '#FFFFFF', 0.98); 
        const monoBackground = ColorUtils.mixColors(basePrimary, '#FFFFFF', 0.94);

        overrides = {
          '--color-background': monoBackground,
          '--color-surface': monoSurface
        };
        break;

      case 'default':
      default:
        // Default: Se queda con la configuración actual (restaurada arriba)
        break;
    }

    if (Object.keys(overrides).length > 0) {
      this.setCssVariables(overrides);
    }

    root.setAttribute('data-theme-preset', theme);
  }

  /**
   * Resetea solo los overrides de temas, permitiendo que el branding base o CSS global vuelva a actuar.
   */
  private resetThemeOverrides(): void {
    const root = this.document.documentElement;
    root.removeAttribute('data-theme-preset');

    // We need to remove the specific variables we set
    const variablesToRemove = [
      '--color-primary', // Legacy support
      '--color-secondary', // Legacy support
      '--color-accent', // Legacy support
      '--color-ring', // Legacy support
      '--color-primary-light', // Legacy support
      '--color-background', // New dynamic override
      '--color-surface' // New dynamic override
    ];

    variablesToRemove.forEach(varName => {
      root.style.removeProperty(varName);
    });

    // If there was branding applied, re-apply it from current subject
    const currentTheme = this.currentThemeSubject.value;
    // Note: currentTheme might be null if only branding was applied via applyBranding
    // In this codebase, branding seems to be the main way now.
  }

  /**
   * Aplica la configuración completa de la app (theme, branding, seo)
   */
  async applyAppConfiguration(appConfig: AppConfig): Promise<void> {
    try {
      if (appConfig.branding) {
        await this.applyBranding(appConfig.branding);
      }
    } catch (error) {
      console.error('Error applying app configuration:', error);
      throw error;
    }
  }

  /**
   * Aplica el tema CSS.
   * @deprecated El branding ahora maneja todos los aspectos visuales. El tema puede ser eliminado.
   */
  async applyTheme(themeConfig: ThemeConfig): Promise<void> {
    const themeStyles: { [key: string]: string | undefined } = {
      '--color-primary': themeConfig.primaryColor,
      '--color-secondary': themeConfig.secondaryColor,
      '--color-accent': themeConfig.accentColor,
      '--color-background': themeConfig.backgroundColor,
      '--color-text-primary': themeConfig.textColor,
      '--border-radius': themeConfig.borderRadius,
      '--font-base': themeConfig.fontFamily,
    };

    this.setCssVariables(themeStyles);
    if (themeConfig.spacing) {
      this.setCssVariables(this.flattenObject(themeConfig.spacing, 'spacing'));
    }
    if (themeConfig.shadows) {
      this.setCssVariables(this.flattenObject(themeConfig.shadows, 'shadow'));
    }

    if (themeConfig.fontFamily) {
      await this.loadFont(themeConfig.fontFamily);
    }
    this.currentThemeSubject.next(themeConfig);
  }

  /**
   * Aplica la configuración de branding, sobreescribiendo los valores por defecto del CSS.
   */
  async applyBranding(brandingConfig: BrandingConfig): Promise<void> {
    this.currentBranding = brandingConfig;
    if (brandingConfig.colors) {
      const colorStyles: { [key: string]: string | undefined } = {
        '--color-primary': brandingConfig.colors.primary,
        '--color-secondary': brandingConfig.colors.secondary,
        '--color-accent': brandingConfig.colors.accent,
        '--color-background': brandingConfig.colors.background,
        '--color-surface': brandingConfig.colors.surface,
        '--color-text-primary': brandingConfig.colors.text?.primary,
        '--color-text-secondary': brandingConfig.colors.text?.secondary,
        '--color-text-muted': brandingConfig.colors.text?.muted,
        // RGB versions for gradient/rgba usage
        '--color-primary-rgb': this.hexToRgbString(brandingConfig.colors.primary),
        '--color-secondary-rgb': this.hexToRgbString(brandingConfig.colors.secondary),
        '--color-accent-rgb': this.hexToRgbString(brandingConfig.colors.accent),
        '--color-background-rgb': this.hexToRgbString(brandingConfig.colors.background),
        '--color-surface-rgb': this.hexToRgbString(brandingConfig.colors.surface),
      };
      this.setCssVariables(colorStyles);
    }

    if (brandingConfig.fonts) {
      const fontStyles: { [key: string]: string | undefined } = {
        '--font-primary': brandingConfig.fonts.primary,
        '--font-secondary': brandingConfig.fonts.secondary,
        '--font-headings': brandingConfig.fonts.headings,
      };
      this.setCssVariables(fontStyles);

      // Cargar las fuentes necesarias
      for (const font of Object.values(fontStyles)) {
        if (font) await this.loadFont(font);
      }
    }

    if (brandingConfig.customCSS) {
      this.injectCustomCSS(brandingConfig.customCSS, 'custom-branding');
    }

    if (brandingConfig.favicon) {
      this.updateFavicon(brandingConfig.favicon);
    }

    // Re-aplicar el tema del usuario (default, aura, etc.) sobre el nuevo branding cargado.
    // Esto es crucial para solucionar condiciones de carrera donde applyBranding sobreescribe 
    // las modificaciones de applyUserTheme (como transparency en Aura).
    await this.applyUserTheme(this.activeUserTheme);
  }

  /**
   * Convierte un color HEX a string RGB para uso en CSS variables.
   * @param hex Color en formato HEX (ej: #7ed7a5)
   * @returns String RGB (ej: "126, 215, 165") o undefined si es inválido
   */
  private hexToRgbString(hex: string | undefined): string | undefined {
    if (!hex) return undefined;
    const rgb = ColorUtils.hexToRgb(hex);
    if (!rgb) return undefined;
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  }

  /**
   * Establece un conjunto de variables CSS en el elemento raíz.
   * @param variables - Un objeto donde las claves son nombres de variables CSS y los valores son sus valores.
   */
  private setCssVariables(variables: {
    [key: string]: string | undefined;
  }): void {
    const root = this.document.documentElement;
    Object.entries(variables).forEach(([key, value]) => {
      if (value) {
        root.style.setProperty(key, value);
      }
    });
  }

  /**
   * Aplana un objeto anidado para usarlo como variables CSS.
   * ej: { sm: '1px' } con el prefijo 'shadow' se convierte en { '--shadow-sm': '1px' }
   */
  private flattenObject(
    obj: object,
    prefix: string,
  ): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    Object.entries(obj).forEach(([key, value]) => {
      result[`--${prefix}-${key}`] = value;
    });
    return result;
  }

  /**
   * Carga una fuente externa
   */
  async loadFont(fontFamily: string): Promise<void> {
    if (!fontFamily || this.loadedFonts.has(fontFamily)) {
      return;
    }

    try {
      const fontName = this.extractFontName(fontFamily);
      if (this.isGoogleFont(fontName)) {
        await this.loadGoogleFont(fontName);
      }
      this.loadedFonts.add(fontFamily);
    } catch (error) {
      console.error(`Failed to load font: ${fontFamily}`, error);
    }
  }

  /**
   * Verifica si es una fuente de Google Fonts
   */
  private isGoogleFont(fontName: string): boolean {
    const googleFonts = [
      'Inter',
      'Roboto',
      'Open Sans',
      'Lato',
      'Montserrat',
      'Poppins',
      'Nunito',
      'Ubuntu',
      'Raleway',
      'Work Sans',
    ];
    return googleFonts.includes(fontName);
  }

  /**
   * Extrae el nombre de la fuente de la declaración CSS
   */
  private extractFontName(fontFamily: string): string {
    return fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  }

  /**
   * Carga una fuente de Google Fonts
   */
  private async loadGoogleFont(fontName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const linkId = `google-font-${fontName.toLowerCase().replace(' ', '-')}`;
      if (this.document.getElementById(linkId)) {
        resolve();
        return;
      }

      const link = this.document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(' ', '+')}:wght@300;400;500;600;700&display=swap`;

      link.onload = () => resolve();
      link.onerror = () =>
        reject(new Error(`Failed to load Google Font: ${fontName}`));

      this.document.head.appendChild(link);
    });
  }

  /**
   * Inyecta CSS personalizado
   */
  injectCustomCSS(css: string, id: string = 'custom-css'): void {
    if (this.injectedStyleElements.has(id)) {
      const oldElement = this.injectedStyleElements.get(id)!;
      oldElement.remove();
    }

    const styleElement = this.document.createElement('style');
    styleElement.id = id;
    styleElement.textContent = css;

    this.document.head.appendChild(styleElement);
    this.injectedStyleElements.set(id, styleElement);
  }

  /**
   * Actualiza el favicon
   */
  updateFavicon(faviconUrl: string): void {
    try {
      let favicon = this.document.querySelector(
        'link[rel="icon"]',
      ) as HTMLLinkElement;
      if (!favicon) {
        favicon = this.document.createElement('link');
        favicon.rel = 'icon';
        this.document.head.appendChild(favicon);
      }
      favicon.href = faviconUrl;
    } catch (error) {
      console.error('Failed to update favicon:', error);
    }
  }

  /**
   * Resetea el tema a los valores por defecto del CSS.
   */
  resetTheme(): void {
    const root = this.document.documentElement;

    // Remover todos los estilos en línea para que se apliquen los de la hoja de estilos.
    root.removeAttribute('style');

    // Remover CSS inyectado
    this.injectedStyleElements.forEach((element) => {
      element.remove();
    });
    this.injectedStyleElements.clear();

    // Limpiar fuentes cargadas (no removemos los <link> de fuentes por simplicidad)
    this.loadedFonts.clear();

    this.currentThemeSubject.next(null);
  }

  /**
   * Transforma el branding desde el formato de API al formato interno.
   * Los valores no definidos en la API resultarán en `undefined` para que se usen los fallbacks de CSS.
   */
  transformBrandingFromApi(apiBranding: any): BrandingConfig {
    return {
      colors: {
        primary: apiBranding.primary_color,
        secondary: apiBranding.secondary_color,
        accent: apiBranding.accent_color,
        background: apiBranding.background_color,
        surface: apiBranding.surface_color,
        text: {
          primary: apiBranding.text_color,
          secondary: apiBranding.text_secondary_color,
          muted: apiBranding.text_muted_color,
        },
      },
      fonts: {
        primary: apiBranding.font_primary,
        secondary: apiBranding.font_secondary,
        headings: apiBranding.font_headings,
      },
      logo: {
        url: apiBranding.logo_url,
        alt: apiBranding.name,
      },
      favicon: apiBranding.favicon_url,
      customCSS: apiBranding.custom_css,
    };
  }

  /**
   * Transforma el tema desde el formato de API al formato interno.
   * @deprecated Usar `transformBrandingFromApi` en su lugar.
   */
  transformThemeFromApi(apiTheme: any): ThemeConfig {
    return {
      name: apiTheme.name,
      primaryColor: apiTheme.primary_color || apiTheme.primaryColor,
      secondaryColor: apiTheme.secondary_color || apiTheme.secondaryColor,
      accentColor: apiTheme.accent_color || apiTheme.accentColor,
      backgroundColor: apiTheme.background_color || apiTheme.backgroundColor,
      textColor: apiTheme.text_color || apiTheme.textColor,
      borderRadius: apiTheme.border_radius || apiTheme.borderRadius,
      fontFamily: apiTheme.font_family || apiTheme.fontFamily,
      spacing: apiTheme.spacing,
      shadows: apiTheme.shadows,
    };
  }
}
