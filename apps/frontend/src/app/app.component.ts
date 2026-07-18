import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { ConfigFacade } from './core/store/config';
import { RouteManagerService } from './core/services/route-manager.service';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';
import { GlobalUserModalsComponent } from './shared/components/global-user-modals/global-user-modals.component';
import { AppLoadingComponent } from './shared/components/app-loading/app-loading.component';
import { StoreUnavailableBannerComponent } from './shared/components/store-unavailable-banner/store-unavailable-banner.component';
import { DomainResolutionErrorComponent } from './shared/components/domain-resolution-error/domain-resolution-error.component';
import { StoreAvailabilityService } from './core/services/store-availability.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    ToastContainerComponent,
    GlobalUserModalsComponent,
    AppLoadingComponent,
    StoreUnavailableBannerComponent,
    DomainResolutionErrorComponent,
  ],
  // Bootstrap state machine — order is intentional:
  //   1. resolutionError  → branded error view (kitten + retry). Highest priority
  //      so a decided failure always wins over stale neutral routes.
  //   2. routesConfigured → the resolved app (tenant storefront / admin / Vendix
  //      landing ONLY when resolution returned app_type=VENDIX_LANDING).
  //   3. otherwise         → neutral Vendix splash (initial boot AND retry).
  // The pre-Angular gate in index.html keeps <app-root> hidden until we reach a
  // DECIDED state (error or success), so the prerendered Landing never flashes.
  //
  // HYDRATION PARITY: every branch is gated behind `hydrated()`, which is FALSE
  // on the server AND on the client's first (hydration) render, and only flips
  // to TRUE via afterNextRender (browser-only, post-hydration). The prerendered
  // '/' document serializes the @else branch (<app-loading>); the client hydrates
  // the SAME <app-loading> branch, so there is no root-@if mismatch even though
  // the client's blocking APP_INITIALIZER has already made routesConfigured true.
  // The swap to the resolved app happens as a normal post-hydration update.
  template: `
    @if (hydrated() && resolutionError(); as err) {
      <app-domain-resolution-error [kind]="err.kind" (retry)="onRetry()" />
    } @else if (hydrated() && routesConfigured()) {
      <main>
        <router-outlet></router-outlet>
      </main>
      @if (isBrowser) {
        <app-toast-container></app-toast-container>
        <app-global-user-modals></app-global-user-modals>
      }
      <!-- Public storefront: full-screen "store unavailable" banner. Rendered
           as an overlay ON TOP of the router-outlet so dismissing it reveals
           the catalog underneath (read-only mode). The backend is the real
           block; this reinforces the UX. -->
      @if (storeAvailability.shouldShowBanner()) {
        <app-store-unavailable-banner />
      }
    } @else {
      <app-loading />
    }
  `,
  styles: `
    :host {
      color-scheme: light;
    }
  `,
})
export class AppComponent {
  private routeManager = inject(RouteManagerService);
  private configFacade = inject(ConfigFacade);
  private platformId = inject(PLATFORM_ID);
  // Public storefront availability (drives the full-screen unavailable banner).
  readonly storeAvailability = inject(StoreAvailabilityService);

  readonly isBrowser = isPlatformBrowser(this.platformId);

  /** Typed domain/app_type resolution failure (null while resolving/on success). */
  readonly resolutionError = this.configFacade.resolutionError;

  protected readonly routesConfigured = toSignal(this.routeManager.routesConfigured$, {
    initialValue: false,
  });

  /**
   * FALSE on the server and on the client's first (hydration) render; flipped to
   * TRUE by afterNextRender AFTER hydration has settled (browser-only — it never
   * runs during SSR). Gating the root @if behind this guarantees server/client
   * render the identical <app-loading> branch at the hydration instant, so the
   * neutral prerendered '/' never causes a root-@if mismatch. The swap to the
   * resolved view is then a normal post-hydration change-detection update.
   */
  protected readonly hydrated = signal(false);

  constructor() {
    // Flip to the resolved view only AFTER hydration is complete, so the root
    // @if matches the prerendered <app-loading> branch during hydration.
    afterNextRender(() => this.hydrated.set(true));

    // Reveal <app-root> ONLY once hydration has settled AND the bootstrap reached
    // a decided state — a resolution error OR successfully configured routes.
    // The `hydrated` guard keeps the neutral <app-loading> hidden under the gate
    // while it is swapped for the resolved app, so nothing flashes on any host.
    effect(() => {
      if (this.hydrated() && (this.resolutionError() || this.routesConfigured())) {
        this.removePrerenderGate();
      }
    });
  }

  /**
   * Retry handler for the error view. A full reload re-runs the entire
   * bootstrap from scratch (domain resolution included) and, thanks to the
   * synchronous gate in index.html, the branded splash paints immediately with
   * no white flash. This is deliberately more robust than the in-app NgRx
   * retry(): it sidesteps stale neutral routes and the missing re-navigation
   * after router.resetConfig() on a mid-session retry.
   */
  onRetry(): void {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  private removePrerenderGate(): void {
    if (typeof document === 'undefined') return;

    document.documentElement.classList.remove('vendix-prerender-hidden');
    document.getElementById('vendix-prerender-gate')?.remove();
    document.querySelector('.vendix-gate-spinner')?.remove();
  }
}
