import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { ToastService } from '../toast/toast.service';
import { SessionService } from '../../../core/services/session.service';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { AppEnvironment } from '../../../core/models/domain-config.interface';

/**
 * NotFoundRedirectComponent - catch-all route.
 *
 * Strategy:
 * - If NOT authenticated and the URL belongs to a private panel (/admin,
 *   /super-admin, /repartos, /onboarding…) → go straight to the login page.
 *   This is the usual case of an expired session on a deep link: the private
 *   routes are only registered with a session, so the URL falls here.
 * - If NOT authenticated and the URL is anything else (visitors and crawlers)
 *   → render a "page not found" view marked `noindex, follow`, without
 *   redirecting (SEO-TECH-03). The previous redirect to "/" made every
 *   unknown URL look like a copy of the home page to Google (soft 404).
 * - If authenticated → redirect to the initial route of their current app
 *
 * App initial routes:
 * - VENDIX_LANDING → /
 * - VENDIX_ADMIN → /superadmin/dashboard
 * - ORG_LANDING → /
 * - ORG_ADMIN → /admin/dashboard
 * - STORE_ADMIN → /admin/dashboard
 * - STORE_ECOMMERCE → /
 * - STORE_LANDING → /
 * - STORE_DELIVERY → /repartos
 */
/** Login page shared by every host (static auth routes). */
export const LOGIN_URL = '/auth/login';

/**
 * Private panels that only exist with a session. Without one, their URLs fall
 * into this catch-all; they are not "not found", the session ended.
 */
export const PRIVATE_PANEL_PREFIXES: readonly string[] = [
  '/admin',
  '/super-admin',
  '/superadmin',
  '/repartos',
  '/onboarding',
];

export function isPrivatePanelPath(path: string): boolean {
  return PRIVATE_PANEL_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}

@Component({
  selector: 'app-not-found-redirect',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (showNotFound()) {
      <section class="not-found" aria-labelledby="not-found-title">
        <p class="not-found__code">404</p>
        <h1 id="not-found-title">Página no encontrada</h1>
        <p>La dirección que abriste no existe o ya no está disponible.</p>
        <a routerLink="/" class="not-found__link">Ir al inicio</a>
      </section>
    }
  `,
  styles: [
    `
      .not-found {
        max-width: 32rem;
        margin: 4rem auto;
        padding: 0 1rem;
        text-align: center;
      }
      .not-found__code {
        font-size: 3rem;
        font-weight: 700;
        margin: 0;
        opacity: 0.4;
      }
      .not-found__link {
        display: inline-block;
        margin-top: 1rem;
        font-weight: 600;
        text-decoration: underline;
      }
    `,
  ],
})
export class NotFoundRedirectComponent {
  private router = inject(Router);
  private toastService = inject(ToastService);
  private authFacade = inject(AuthFacade);
  private sessionService = inject(SessionService);
  private document = inject(DOCUMENT);
  private title = inject(Title);
  private meta = inject(Meta);
  private destroyRef = inject(DestroyRef);

  /** Visible "page not found" view for unauthenticated visitors. */
  readonly showNotFound = signal(false);

  private readonly APP_REDIRECT_MAP: Record<string, string> = {
    [AppEnvironment.VENDIX_LANDING]: '/',
    [AppEnvironment.VENDIX_ADMIN]: '/super-admin/dashboard',
    [AppEnvironment.ORG_LANDING]: '/',
    [AppEnvironment.ORG_ADMIN]: '/admin/dashboard',
    [AppEnvironment.STORE_ADMIN]: '/admin/dashboard',
    [AppEnvironment.STORE_ECOMMERCE]: '/',
    [AppEnvironment.STORE_LANDING]: '/',
    [AppEnvironment.STORE_DELIVERY]: '/repartos',
  };

  constructor() {
    if (this.sessionService.isTerminating()) {
      return;
    }

    const isAuthenticated = this.authFacade.isAuthenticated();

    if (!isAuthenticated) {
      if (isPrivatePanelPath(this.requestedPath())) {
        // Expired session on a panel URL: back to login, without a 404 screen.
        this.router.navigateByUrl(LOGIN_URL, { replaceUrl: true });
        return;
      }
      this.showNotFound.set(true);
      this.applyNotFoundMetadata();
      return;
    }

    if (!this.sessionService.shouldSuppressNotifications()) {
      this.toastService.warning(
        'La ruta solicitada no existe o no está disponible',
        'Ruta no encontrada',
      );
    }

    const appType = this.authFacade.selectedAppType();
    this.router.navigate([this.getRedirectUrl(appType)]);
  }

  /** Path being opened (the one that fell into the catch-all), without query or fragment. */
  private requestedPath(): string {
    const finalUrl = this.router.getCurrentNavigation()?.finalUrl;
    const url = finalUrl ? this.router.serializeUrl(finalUrl) : this.document.location?.pathname || this.router.url;
    return url.split(/[?#]/)[0];
  }

  private getRedirectUrl(appType: string): string {
    // Get redirect URL based on app type
    return this.APP_REDIRECT_MAP[appType] || '/admin/dashboard';
  }

  /**
   * `noindex, follow` and no canonical while the 404 view is on screen; the
   * previous values come back when the user leaves (e.g. "Ir al inicio").
   */
  private applyNotFoundMetadata(): void {
    const previousTitle = this.title.getTitle();
    const previousRobots = this.meta.getTag('name="robots"')?.getAttribute('content') ?? null;
    const canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = canonical?.getAttribute('href') ?? null;

    this.title.setTitle('Página no encontrada');
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    canonical?.removeAttribute('href');

    this.destroyRef.onDestroy(() => {
      if (this.title.getTitle() === 'Página no encontrada') this.title.setTitle(previousTitle);
      const robots = this.meta.getTag('name="robots"');
      if (robots?.getAttribute('content') === 'noindex, follow') {
        if (previousRobots === null) robots.remove();
        else robots.setAttribute('content', previousRobots);
      }
      if (canonical && previousCanonical !== null && !canonical.hasAttribute('href')) {
        canonical.setAttribute('href', previousCanonical);
      }
    });
  }
}
