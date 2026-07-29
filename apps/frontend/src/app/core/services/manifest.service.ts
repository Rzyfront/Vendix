import { Injectable, inject, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppType, DomainConfig } from '../models/domain-config.interface';

/**
 * ManifestService
 *
 * El Web App Manifest YA NO se construye ni se inyecta desde el frontend.
 * Lo sirve el backend en `GET /manifest.webmanifest`, del MISMO ORIGEN, resuelto
 * por hostname, junto con sus iconos en `/pwa/*.png` (sin firma, sin vencimiento).
 * El `<link rel="manifest" href="/manifest.webmanifest">` es estático en
 * `index.html`: la instalación puede dispararse antes de que Angular arranque, así
 * que manifest e iconos deben existir en la primera respuesta HTTP.
 *
 * Motivo del cambio (QUI-263): antes se inyectaba el manifest como Blob URL. Un
 * Blob URL rompe los criterios de instalabilidad de Chromium (Windows/Chrome y Edge
 * caen al favicon) y Safari directamente no lo lee; además los iconos declarados
 * eran URLs S3 prefirmadas que vencían en 24 h.
 *
 * Este servicio queda reducido a sincronizar en runtime SÓLO lo que el HTML estático
 * no puede saber sin resolver el tenant y que el manifest no cubre:
 *  - `<meta name="apple-mobile-web-app-title">`: iOS toma de ahí el nombre de la app
 *    instalada en la pantalla de inicio, NO de `name`/`short_name` del manifest.
 *  - `<meta name="theme-color">`: color de la barra del sistema en modo standalone.
 *
 * Usa `inject(DOCUMENT)` (Angular 20) en vez del `document` global y respeta SSR con
 * el guard `isPlatformBrowser`.
 */
@Injectable({ providedIn: 'root' })
export class ManifestService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private static readonly DEFAULT_THEME_COLOR = '#2F6F4E';

  /**
   * Sincroniza con el tenant resuelto los meta que el manifest servido por el
   * backend no cubre. No toca `<link rel="manifest">` ni `<link rel="apple-touch-icon">`:
   * ambos son estáticos y del mismo origen, resueltos por Host en el borde.
   */
  applyManifest(config: DomainConfig | null | undefined): void {
    // SSR / defensivo: sin DOM no hay meta que actualizar.
    if (!this.isBrowser || !config) return;

    try {
      const branding = config.customConfig?.branding;
      const appType = config.environment;

      const appName = this.resolveName(config, appType);
      const themeColor =
        branding?.primary_color || ManifestService.DEFAULT_THEME_COLOR;

      this.updateThemeColorMeta(themeColor);
      // iOS ignora name/short_name del manifest: el nombre de la app instalada en
      // pantalla de inicio viene de apple-mobile-web-app-title.
      this.updateAppleWebAppTitle(appName);
    } catch (error) {
      console.error('[ManifestService] Failed to apply manifest:', error);
    }
  }

  /**
   * Resuelve el nombre de la app según el tipo:
   * STORE_* → store_name; ORG_* → organization_name; VENDIX_* → 'Vendix'.
   * Fallback final 'Vendix' si el nombre resuelto viene vacío.
   */
  private resolveName(config: DomainConfig, appType: AppType): string {
    let name: string | undefined;

    if (this.isStoreApp(appType)) {
      name = config.store_name;
    } else if (this.isOrgApp(appType)) {
      name = config.organization_name;
    } else {
      name = 'Vendix';
    }

    return (name && name.trim()) || 'Vendix';
  }

  /**
   * Actualiza (o crea) el `<meta name="apple-mobile-web-app-title">` con el nombre
   * del tenant. iOS no usa `name`/`short_name` del manifest para la app instalada;
   * sin este meta tomaría el `<title>` de SEO.
   */
  private updateAppleWebAppTitle(appName: string): void {
    let meta = this.document.querySelector(
      'meta[name="apple-mobile-web-app-title"]',
    ) as HTMLMetaElement | null;

    if (!meta) {
      meta = this.document.createElement('meta');
      meta.name = 'apple-mobile-web-app-title';
      this.document.head.appendChild(meta);
    }

    meta.content = appName;
  }

  /**
   * Actualiza (o crea) el `<meta name="theme-color">`.
   */
  private updateThemeColorMeta(themeColor: string): void {
    let meta = this.document.querySelector(
      'meta[name="theme-color"]',
    ) as HTMLMetaElement | null;

    if (!meta) {
      meta = this.document.createElement('meta');
      meta.name = 'theme-color';
      this.document.head.appendChild(meta);
    }

    meta.content = themeColor;
  }

  private isStoreApp(appType: AppType): boolean {
    return (
      appType === AppType.STORE_ADMIN ||
      appType === AppType.STORE_ECOMMERCE ||
      appType === AppType.STORE_LANDING
    );
  }

  private isOrgApp(appType: AppType): boolean {
    return appType === AppType.ORG_ADMIN || appType === AppType.ORG_LANDING;
  }
}
