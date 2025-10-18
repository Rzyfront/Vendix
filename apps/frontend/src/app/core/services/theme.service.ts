import { Injectable, Inject, DOCUMENT } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TenantConfig, BrandingConfig, ThemeConfig } from '../models/tenant-config.interface';
import { AppConfig } from './app-config.service'; // Import AppConfig

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private currentThemeSubject = new BehaviorSubject<ThemeConfig | null>(null);
  public currentTheme$ = this.currentThemeSubject.asObservable();

  private loadedFonts = new Set<string>();
  private injectedStyleElements = new Map<string, HTMLStyleElement>();

  constructor(@Inject(DOCUMENT) private document: Document) {}

  /**
   * Aplica la configuración completa de la app (theme, branding, seo)
   */
  async applyAppConfiguration(appConfig: AppConfig): Promise<void> {
    try {
      console.log('[THEME SERVICE] Applying app configuration:', appConfig);
      
      // Use the sanitized branding object from AppConfig
      if (appConfig.branding) {
        await this.applyBranding(appConfig.branding);
      } else {
        console.warn('[THEME SERVICE] App configuration is missing \'branding\' object. Skipping branding application.');
      }

      // Theme and SEO still come from the nested tenantConfig
      if (appConfig.tenantConfig?.theme) {
        await this.applyTheme(appConfig.tenantConfig.theme);
      } else {
        console.warn('[THEME SERVICE] Tenant configuration is missing \'theme\' object. Skipping theme application.');
      }
      
      if (appConfig.tenantConfig?.seo) {
        this.applySEOConfiguration(appConfig.tenantConfig.seo);
      } else {
        console.warn('[THEME SERVICE] Tenant configuration is missing \'seo\' object. Skipping SEO application.');
      }
      
      console.log('[THEME SERVICE] App configuration applied successfully');
      
    } catch (error) {
      console.error('[THEME SERVICE] Error applying app configuration:', error);
      throw error;
    }
  }

  /**
   * Aplica el tema CSS
   */
  async applyTheme(themeConfig: ThemeConfig): Promise<void> {
    console.log('[THEME SERVICE] Applying theme:', themeConfig.name);
    
    // Aplicar colores CSS
    this.applyColorVariables(themeConfig);
    
    // Aplicar espaciado
    this.applySpacingVariables(themeConfig);
    
    // Aplicar sombras
    this.applyShadowVariables(themeConfig);
    
    // Cargar fuentes
    await this.loadFont(themeConfig.fontFamily);
    
    // Aplicar fuente base
    this.applyFontVariables(themeConfig);
    
    // Guardar tema actual
    this.currentThemeSubject.next(themeConfig);
  }

  /**
   * Aplica la configuración de branding
   */
  async applyBranding(brandingConfig: BrandingConfig): Promise<void> {
    console.log('[THEME SERVICE] Applying branding configuration');
    
    // Add defensive checks for nested properties
    if (brandingConfig.colors) {
      this.applyBrandingColors(brandingConfig.colors);
    }

    if (brandingConfig.fonts) {
      if (brandingConfig.fonts.primary) {
        await this.loadFont(brandingConfig.fonts.primary);
      }
      if (brandingConfig.fonts.secondary) {
        await this.loadFont(brandingConfig.fonts.secondary);
      }
      if (brandingConfig.fonts.headings) {
        await this.loadFont(brandingConfig.fonts.headings);
      }
      this.applyBrandingFonts(brandingConfig.fonts);
    }

    if (brandingConfig.customCSS) {
      this.injectCustomCSS(brandingConfig.customCSS, 'custom-branding');
    }

    if (brandingConfig.favicon) {
      this.updateFavicon(brandingConfig.favicon);
    }
  }

  /**
   * Aplica variables de colores CSS
   */
  private applyColorVariables(themeConfig: ThemeConfig): void {
    const root = this.document.documentElement;
    
    root.style.setProperty('--color-primary', themeConfig.primaryColor);
    root.style.setProperty('--color-secondary', themeConfig.secondaryColor);
    root.style.setProperty('--color-accent', themeConfig.accentColor);
    root.style.setProperty('--color-background', themeConfig.backgroundColor);
    root.style.setProperty('--color-text-primary', themeConfig.textColor);
    root.style.setProperty('--border-radius', themeConfig.borderRadius);
  }

  /**
   * Aplica colores de branding personalizados
   */
  private applyBrandingColors(colors: BrandingConfig['colors']): void {
    const root = this.document.documentElement;
    
    root.style.setProperty('--color-primary', colors.primary);
    root.style.setProperty('--color-secondary', colors.secondary);
    root.style.setProperty('--color-accent', colors.accent);
    root.style.setProperty('--color-background', colors.background);
    root.style.setProperty('--color-surface', colors.surface);
    root.style.setProperty('--color-text-primary', colors.text.primary);
    root.style.setProperty('--color-text-secondary', colors.text.secondary);
    root.style.setProperty('--color-text-muted', colors.text.muted);
  }

  /**
   * Aplica variables de espaciado
   */
  private applySpacingVariables(themeConfig: ThemeConfig): void {
    const root = this.document.documentElement;
    
    Object.entries(themeConfig.spacing).forEach(([key, value]) => {
      root.style.setProperty(`--spacing-${key}`, value);
    });
  }

  /**
   * Aplica variables de sombras
   */
  private applyShadowVariables(themeConfig: ThemeConfig): void {
    const root = this.document.documentElement;
    
    Object.entries(themeConfig.shadows).forEach(([key, value]) => {
      root.style.setProperty(`--shadow-${key}`, value);
    });
  }

  /**
   * Aplica variables de fuente del tema
   */
  private applyFontVariables(themeConfig: ThemeConfig): void {
    const root = this.document.documentElement;
    root.style.setProperty('--font-base', themeConfig.fontFamily);
  }

  /**
   * Aplica fuentes de branding personalizadas
   */
  private applyBrandingFonts(fonts: BrandingConfig['fonts']): void {
    const root = this.document.documentElement;
    
    if (fonts.primary) {
      root.style.setProperty('--font-primary', fonts.primary);
    }
    
    if (fonts.secondary) {
      root.style.setProperty('--font-secondary', fonts.secondary);
    }
    
    if (fonts.headings) {
      root.style.setProperty('--font-headings', fonts.headings);
    }
  }

  /**
   * Carga una fuente externa
   */
  async loadFont(fontFamily: string): Promise<void> {
    if (this.loadedFonts.has(fontFamily)) {
      return; // Ya está cargada
    }

    try {
      // Extraer el nombre de la fuente para Google Fonts
      const fontName = this.extractFontName(fontFamily);
      
      if (this.isGoogleFont(fontName)) {
        await this.loadGoogleFont(fontName);
      }
      
      this.loadedFonts.add(fontFamily);
      console.log(`[THEME SERVICE] Font loaded: ${fontFamily}`);
      
    } catch (error) {
      console.warn(`[THEME SERVICE] Failed to load font: ${fontFamily}`, error);
    }
  }

  /**
   * Verifica si es una fuente de Google Fonts
   */
  private isGoogleFont(fontName: string): boolean {
    const googleFonts = [
      'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 
      'Poppins', 'Nunito', 'Ubuntu', 'Raleway', 'Work Sans'
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
      
      // Verificar si ya existe
      if (this.document.getElementById(linkId)) {
        resolve();
        return;
      }
      
      // Crear elemento link
      const link = this.document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(' ', '+')}:wght@300;400;500;600;700&display=swap`;
      
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load Google Font: ${fontName}`));
      
      // Añadir al head
      this.document.head.appendChild(link);
    });
  }

  /**
   * Inyecta CSS personalizado
   */
  injectCustomCSS(css: string, id: string = 'custom-css'): void {
    // Remover CSS anterior si existe
    if (this.injectedStyleElements.has(id)) {
      const oldElement = this.injectedStyleElements.get(id)!;
      oldElement.remove();
    }
    
    // Crear nuevo elemento style
    const styleElement = this.document.createElement('style');
    styleElement.id = id;
    styleElement.textContent = css;
    
    // Añadir al head
    this.document.head.appendChild(styleElement);
    
    // Guardar referencia
    this.injectedStyleElements.set(id, styleElement);
    
    console.log(`[THEME SERVICE] Custom CSS injected: ${id}`);
  }

  /**
   * Actualiza el favicon
   */
  updateFavicon(faviconUrl: string): void {
    try {
      // Buscar favicon existente
      let favicon = this.document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      
      if (!favicon) {
        // Crear nuevo favicon
        favicon = this.document.createElement('link');
        favicon.rel = 'icon';
        this.document.head.appendChild(favicon);
      }
      
      favicon.href = faviconUrl;
      console.log(`[THEME SERVICE] Favicon updated: ${faviconUrl}`);
      
    } catch (error) {
      console.warn('[THEME SERVICE] Failed to update favicon:', error);
    }
  }

  /**
   * Aplica configuración SEO
   */
  private applySEOConfiguration(seoConfig: any): void {
    try {
      // Actualizar título
      if (seoConfig.title) {
        this.document.title = seoConfig.title;
      }
      
      // Actualizar meta tags
      this.updateMetaTag('description', seoConfig.description);
      this.updateMetaTag('keywords', seoConfig.keywords?.join(', '));
      
      // Open Graph
      this.updateMetaTag('og:title', seoConfig.ogTitle || seoConfig.title);
      this.updateMetaTag('og:description', seoConfig.ogDescription || seoConfig.description);
      this.updateMetaTag('og:image', seoConfig.ogImage);
      
      // Twitter
      this.updateMetaTag('twitter:card', seoConfig.twitterCard || 'summary_large_image');
      this.updateMetaTag('twitter:site', seoConfig.twitterSite);
      
      // Canonical URL
      if (seoConfig.canonicalUrl) {
        this.updateCanonicalUrl(seoConfig.canonicalUrl);
      }
      
      // Robots
      this.updateMetaTag('robots', seoConfig.robots || 'index, follow');
      
      console.log('[THEME SERVICE] SEO configuration applied');
      
    } catch (error) {
      console.warn('[THEME SERVICE] Failed to apply SEO configuration:', error);
    }
  }

  /**
   * Actualiza un meta tag
   */
  private updateMetaTag(name: string, content: string): void {
    if (!content) return;
    
    const selector = name.startsWith('og:') || name.startsWith('twitter:') 
      ? `meta[property="${name}"]` 
      : `meta[name="${name}"]`;
      
    let meta = this.document.querySelector(selector) as HTMLMetaElement;
    
    if (!meta) {
      meta = this.document.createElement('meta');
      if (name.startsWith('og:') || name.startsWith('twitter:')) {
        meta.setAttribute('property', name);
      } else {
        meta.setAttribute('name', name);
      }
      this.document.head.appendChild(meta);
    }
    
    meta.setAttribute('content', content);
  }

  /**
   * Actualiza la URL canónica
   */
  private updateCanonicalUrl(url: string): void {
    let canonical = this.document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    
    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.rel = 'canonical';
      this.document.head.appendChild(canonical);
    }
    
    canonical.href = url;
  }

  /**
   * Obtiene el tema actual
   */
  getCurrentTheme(): ThemeConfig | null {
    return this.currentThemeSubject.value;
  }

  /**
   * Resetea el tema a los valores por defecto
   */
  resetTheme(): void {
    const root = this.document.documentElement;
    
    // Remover variables CSS personalizadas
    const customProperties = [
      '--color-primary', '--color-secondary', '--color-accent',
      '--color-background', '--color-surface', '--color-text-primary',
      '--color-text-secondary', '--color-text-muted', '--font-primary',
      '--font-secondary', '--font-headings'
    ];
    
    customProperties.forEach(prop => {
      root.style.removeProperty(prop);
    });
    
    // Remover CSS inyectado
    this.injectedStyleElements.forEach((element, id) => {
      element.remove();
    });
    this.injectedStyleElements.clear();
    
    // Limpiar fuentes cargadas
    this.loadedFonts.clear();
    
    // Resetear tema actual
    this.currentThemeSubject.next(null);
    
    console.log('[THEME SERVICE] Theme reset to default');
  }

  /**
   * Transforma el branding desde el formato de API al formato interno
   * Soluciona el problema de mapeo incorrecto identificado en el plan de reestructuración
   */
  transformBrandingFromApi(apiBranding: any): BrandingConfig {
    return {
      colors: {
        primary: apiBranding.primary_color || '#3b82f6',
        secondary: apiBranding.secondary_color || '#6b7280',
        accent: apiBranding.accent_color || '#8b5cf6',
        background: apiBranding.background_color || '#ffffff',
        surface: apiBranding.background_color || '#f8fafc',
        text: {
          primary: apiBranding.text_color || '#1f2937',
          secondary: apiBranding.text_color || '#6b7280',
          muted: apiBranding.text_color || '#9ca3af'
        }
      },
      fonts: {
        primary: 'Inter, sans-serif',
        secondary: 'Inter, sans-serif',
        headings: 'Inter, sans-serif'
      },
      logo: {
        url: apiBranding.logo_url || '',
        alt: apiBranding.name || 'Logo'
      },
      favicon: apiBranding.favicon_url || '',
      customCSS: apiBranding.custom_css || ''
    };
  }

  /**
   * Transforma el tema desde el formato de API al formato interno
   */
  transformThemeFromApi(apiTheme: any): ThemeConfig {
    return {
      name: apiTheme.name || 'default',
      primaryColor: apiTheme.primary_color || apiTheme.primaryColor || '#3b82f6',
      secondaryColor: apiTheme.secondary_color || apiTheme.secondaryColor || '#6b7280',
      accentColor: apiTheme.accent_color || apiTheme.accentColor || '#8b5cf6',
      backgroundColor: apiTheme.background_color || apiTheme.backgroundColor || '#ffffff',
      textColor: apiTheme.text_color || apiTheme.textColor || '#1f2937',
      borderRadius: apiTheme.border_radius || apiTheme.borderRadius || '0.375rem',
      fontFamily: apiTheme.font_family || apiTheme.fontFamily || 'Inter, sans-serif',
      spacing: apiTheme.spacing || {
        xs: '0.25rem',
        sm: '0.5rem',
        md: '1rem',
        lg: '1.5rem',
        xl: '2rem'
      },
      shadows: apiTheme.shadows || {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)'
      }
    };
  }
}
