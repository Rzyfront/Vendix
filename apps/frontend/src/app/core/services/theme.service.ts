import { Injectable, Inject, DOCUMENT } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TenantConfig, BrandingConfig, ThemeConfig } from '../models/tenant-config.interface';

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
   * Aplica la configuración completa del tenant
   */
  async applyTenantConfiguration(tenantConfig: TenantConfig): Promise<void> {
    try {
      console.log('[THEME SERVICE] Applying tenant configuration:', tenantConfig);
      
      // 1. Aplicar tema base
      await this.applyTheme(tenantConfig.theme);
      
      // 2. Aplicar branding
      await this.applyBranding(tenantConfig.branding);
      
      // 3. Configurar SEO
      this.applySEOConfiguration(tenantConfig.seo);
      
      console.log('[THEME SERVICE] Tenant configuration applied successfully');
      
    } catch (error) {
      console.error('[THEME SERVICE] Error applying tenant configuration:', error);
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
    
    // Aplicar colores personalizados
    this.applyBrandingColors(brandingConfig.colors);
    
    // Cargar fuentes personalizadas
    if (brandingConfig.fonts.primary) {
      await this.loadFont(brandingConfig.fonts.primary);
    }
    
    if (brandingConfig.fonts.secondary) {
      await this.loadFont(brandingConfig.fonts.secondary);
    }
    
    if (brandingConfig.fonts.headings) {
      await this.loadFont(brandingConfig.fonts.headings);
    }
    
    // Aplicar fuentes personalizadas
    this.applyBrandingFonts(brandingConfig.fonts);
    
    // Inyectar CSS personalizado
    if (brandingConfig.customCSS) {
      this.injectCustomCSS(brandingConfig.customCSS, 'custom-branding');
    }
    
    // Actualizar favicon
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
}
