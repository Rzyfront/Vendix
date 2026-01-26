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
