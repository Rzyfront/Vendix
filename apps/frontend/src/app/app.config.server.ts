import { mergeApplicationConfig } from '@angular/core';
import {
  provideServerRendering,
  withRoutes,
  RenderMode,
} from '@angular/ssr';
import { appConfig } from './app.config';

/**
 * Server configuration for Angular SSR / pre-rendering.
 *
 * ── Anti-"bleed" contract ──────────────────────────────────────────────────
 * The root path '/' is HOST-DEPENDENT: depending on the incoming domain it is a
 * tenant storefront (STORE_ECOMMERCE), an org/store admin, or the Vendix
 * marketing landing (VENDIX_LANDING). During pre-rendering there is NO real
 * domain to resolve, so the server cannot know which app '/' should be.
 *
 * Previously an APP_INITIALIZER here dispatched
 *   initializeAppSuccess({ environment: VENDIX_LANDING, routes: landingRoutes })
 * UNCONDITIONALLY. That baked the Vendix Landing into the single prerendered '/'
 * document, which the SSR layer then served as the root document for EVERY host.
 * Two failures followed:
 *   1. BLEED — the landing leaked into tenant subdomains (a store host got the
 *      Vendix Landing HTML as its '/').
 *   2. HYDRATION MISMATCH — the server serialized the root @if branch
 *      `routesConfigured() === true → <router-outlet>` (landing), while the
 *      browser resolves a different app; Angular merged/duplicated the prerender
 *      DOM with the client-resolved DOM (the visible "bleed").
 *
 * Fix: the server no longer resolves or forces any app_type, and '/' is served
 * as a NEUTRAL CSR shell (RenderMode.Client). There is no server-baked view and
 * therefore NO hydration boundary at '/' to mismatch. The synchronous gate in
 * index.html paints the neutral Vendix splash from the first frame; the browser
 * then resolves the real domain client-side and mounts the correct app
 * (including VENDIX_LANDING for core domains, now client-resolved).
 *
 * Trade-off (accepted for correctness): the core marketing landing loses its
 * static prerender and renders client-side after domain resolution. First paint
 * is still instant via the inline index.html gate. Restoring a per-host
 * prerender WITHOUT reintroducing the bleed would require host-aware serving at
 * the edge / Express layer (serve the landing prerender only for core hostnames,
 * a neutral shell for tenant hosts) — that lives outside the Angular app.
 */
const serverConfig = {
  providers: [
    provideServerRendering(
      // NOTE: `prerender-routes.txt` (discoverRoutes:false) forces '/' to be
      // prerendered at build time regardless of the mode declared here, so '/'
      // is emitted as a static SSG document. With the server no longer forcing
      // VENDIX_LANDING (see above), that document is now a NEUTRAL <app-loading>
      // shell — no tenant/landing view is baked, so nothing can bleed across
      // hosts. Root-@if hydration parity is guaranteed on the client side by the
      // `hydrated` gate in app.component.ts (both server and client render
      // <app-loading> at the hydration instant, then the client flips to the
      // resolved app after hydration settles).
      withRoutes([
        { path: '', renderMode: RenderMode.Prerender },
        { path: '**', renderMode: RenderMode.Client },
      ]),
    ),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
