import { Injectable, inject, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  AppType,
  BrandingConfig,
  DomainConfig,
} from '../models/domain-config.interface';

/**
 * ManifestService
 *
 * Construye e inyecta en runtime un Web App Manifest dinámico por hostname/tenant,
 * de modo que la SPA sea instalable con la marca correcta (nombre, iconos, color)
 * según el dominio que la sirve.
 *
 * El manifest se sirve como Blob URL (`application/manifest+json`); un Blob URL NO
 * resuelve rutas relativas contra el origin de la página, por lo que TODAS las URLs
 * internas (`start_url`, `scope`, `id`, iconos) se declaran ABSOLUTAS.
 *
 * Replica el patrón de inyección/actualización de `<link>` en el DOM usado por
 * `ThemeService.updateFavicon()`: localizar el elemento existente y, si falta,
 * crearlo y adjuntarlo a `document.head`. Usa `inject(DOCUMENT)` (Angular 20) en
 * vez del `document` global y respeta SSR con el guard `isPlatformBrowser`.
 */
@Injectable({ providedIn: 'root' })
export class ManifestService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Blob URL del manifest actualmente inyectado (para revocarlo al reemplazarlo). */
  private currentManifestUrl: string | null = null;

  private static readonly DEFAULT_THEME_COLOR = '#2F6F4E';
  // Marca Vendix a color (vlogo.png) renderizada a 192/512. Es el ícono
  // instalable por defecto para TODO dominio sin logo de tenant propio
  // (plataforma, organización o tienda sin logo). El logo mono (vlogomono)
  // NO se usa nunca como ícono de app instalada: queda solo para la UI interna.
  private static readonly VENDIX_ICON_192 = '/icons/vendix-192.png';
  private static readonly VENDIX_ICON_512 = '/icons/vendix-512.png';

  /**
   * Construye el manifest desde el `DomainConfig` y lo inyecta como Blob URL.
   * Además actualiza en runtime el `<link rel="apple-touch-icon">` (iOS ignora los
   * iconos del manifest) y el `<meta name="theme-color">`.
   */
  applyManifest(config: DomainConfig | null | undefined): void {
    // SSR / defensivo: sin DOM ni window no hay nada que inyectar.
    if (!this.isBrowser || !config) return;

    try {
      const origin = this.document.defaultView?.location?.origin ?? '';
      const branding = config.customConfig?.branding;
      const appType = config.environment;

      const appName = this.resolveName(config, appType);
      const themeColor =
        branding?.primary_color || ManifestService.DEFAULT_THEME_COLOR;
      const icons = this.resolveIcons(branding, origin);

      const manifest = {
        id: '/',
        name: appName,
        short_name: appName,
        start_url: `${origin}/`,
        scope: `${origin}/`,
        display: 'standalone',
        theme_color: themeColor,
        background_color: themeColor,
        icons,
      };

      this.injectManifest(manifest);
      // iOS ignora los iconos del manifest: sincronizamos apple-touch-icon aparte.
      this.updateAppleTouchIcon(icons[0]?.src);
      this.updateThemeColorMeta(themeColor);
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
   * Cascada de iconos del ÍCONO DE APP INSTALADA (no del logo interno de la UI):
   *  1. Logo del tenant (`branding.logo_url ?? favicon_url`, ya URL absoluta S3) →
   *     una sola URL declarada multi-size; sin `type` porque puede no ser PNG.
   *  2. Cualquier otro caso (plataforma, organización o tienda SIN logo, incluidos
   *     `vendix.online` / `www.vendix.online` que no resuelven logo) → marca Vendix
   *     a COLOR (`vlogo.png` a 192/512). El logo mono `vlogomono.png` NUNCA se usa
   *     como ícono instalable; queda reservado para el logo interno de la UI.
   */
  private resolveIcons(
    branding: BrandingConfig | undefined,
    origin: string,
  ): Array<{ src: string; sizes: string; type?: string }> {
    const tenantLogo = branding?.logo_url ?? branding?.favicon_url;

    if (tenantLogo) {
      return [
        { src: tenantLogo, sizes: '192x192' },
        { src: tenantLogo, sizes: '512x512' },
      ];
    }

    return [
      {
        src: `${origin}${ManifestService.VENDIX_ICON_192}`,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: `${origin}${ManifestService.VENDIX_ICON_512}`,
        sizes: '512x512',
        type: 'image/png',
      },
    ];
  }

  /**
   * Inyecta el manifest como Blob URL en `<link rel="manifest">`, creándolo si falta.
   * Revoca el objectURL previo para no fugar memoria.
   */
  private injectManifest(manifest: Record<string, unknown>): void {
    let link = this.document.querySelector(
      'link[rel="manifest"]',
    ) as HTMLLinkElement | null;

    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'manifest';
      this.document.head.appendChild(link);
    }

    const previousUrl = this.currentManifestUrl;
    const blob = new Blob([JSON.stringify(manifest)], {
      type: 'application/manifest+json',
    });
    const url = URL.createObjectURL(blob);

    link.href = url;
    this.currentManifestUrl = url;

    // Revocar DESPUÉS de reasignar el href para no invalidar el fetch en curso.
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
    }
  }

  /**
   * Actualiza (o crea) el `<link rel="apple-touch-icon">` con el icono resuelto.
   */
  private updateAppleTouchIcon(iconUrl?: string): void {
    if (!iconUrl) return;

    let link = this.document.querySelector(
      'link[rel="apple-touch-icon"]',
    ) as HTMLLinkElement | null;

    if (!link) {
      link = this.document.createElement('link');
      link.rel = 'apple-touch-icon';
      this.document.head.appendChild(link);
    }

    link.href = iconUrl;
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
