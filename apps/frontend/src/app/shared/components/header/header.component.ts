import { Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { IconComponent } from '../icon/icon.component';
import { BadgeComponent } from '../badge/badge.component';
import { UserDropdownComponent } from '../user-dropdown/user-dropdown.component';
import { NotificationsDropdownComponent } from '../notifications-dropdown/notifications-dropdown.component';
import { HelpSearchOverlayComponent } from '../help-search-overlay/help-search-overlay.component';

import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/services/breadcrumb.service';
import { GlobalFacade } from '../../../core/store/global.facade';
import { ConfigFacade } from '../../../core/store/config';
import { AuthFacade } from '../../../core/store/auth/auth.facade';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterModule,
    IconComponent,
    BadgeComponent,
    UserDropdownComponent,
    NotificationsDropdownComponent,
    HelpSearchOverlayComponent,
  ],
  template: `
    <header
      class="bg-transparent border-b-0 sticky top-0 backdrop-blur-md text-slate-900 relative"
      style="z-index: var(--z-header)"
    >
      <div
        class="flex items-center justify-between px-2 py-1 sm:px-3 sm:py-2 md:p-2 gap-1.5 md:gap-6"
      >
        <div class="flex items-center gap-1.5 sm:gap-5 flex-1 min-w-0">
          <!-- Desktop: Toggle Sidebar Button (hamburger) - hidden on mobile -->
          <button
            (click)="toggleSidebar.emit()"
            class="desktop-menu-btn hidden md:flex items-center justify-center flex-shrink-0 p-2 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
            aria-label="Toggle sidebar"
          >
            <app-icon name="menu" [size]="20"></app-icon>
          </button>

          <!-- Mobile: Store Logo + Arrow to open sidebar -->
          <button
            (click)="toggleSidebar.emit()"
            class="flex md:hidden items-center gap-1.5 flex-shrink-0 p-1 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
            aria-label="Abrir menú"
          >
            <div class="mobile-logo-container">
              @if (storeLogo()) {
                <img
                  [src]="storeLogo()"
                  [alt]="storeName() || 'Logo'"
                  class="mobile-logo"
                />
              } @else {
                <div class="mobile-logo-placeholder">
                  <app-icon name="store" [size]="18"></app-icon>
                </div>
              }
            </div>
            <app-icon
              name="chevron-right"
              [size]="14"
              class="text-slate-400"
            ></app-icon>
          </button>

          <!-- Dynamic Breadcrumb -->
          <div class="flex flex-col gap-0 min-w-0 flex-1">
            @if (breadcrumb(); as breadcrumbData) {
              <div
                class="flex items-center gap-1 sm:gap-2 flex-nowrap overflow-hidden"
              >
                @if (breadcrumbData.parent) {
                  @if (breadcrumbData.parent.url) {
                    <a
                      [routerLink]="breadcrumbData.parent.url"
                      class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 no-underline transition-colors duration-200 hover:text-blue-600 min-w-0"
                    >
                      @if (breadcrumbData.parent.icon) {
                        <app-icon
                          [name]="breadcrumbData.parent.icon"
                          [size]="14"
                          class="opacity-70 hidden sm:block flex-shrink-0"
                        ></app-icon>
                      }
                      <span class="truncate">{{
                        breadcrumbData.parent.label
                      }}</span>
                    </a>
                  }
                  @if (!breadcrumbData.parent.url) {
                    <span
                      class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 min-w-0"
                    >
                      @if (breadcrumbData.parent.icon) {
                        <app-icon
                          [name]="breadcrumbData.parent.icon"
                          [size]="14"
                          class="opacity-70 hidden sm:block flex-shrink-0"
                        ></app-icon>
                      }
                      <span class="truncate">{{
                        breadcrumbData.parent.label
                      }}</span>
                    </span>
                  }
                  <span
                    class="text-slate-600 opacity-70 mx-0.5 text-[10px] sm:text-xs font-normal flex-shrink-0"
                    >/</span
                  >
                }
                <span
                  class="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-slate-900 min-w-0"
                >
                  @if (breadcrumbData.current.icon) {
                    <app-icon
                      [name]="breadcrumbData.current.icon"
                      [size]="14"
                      class="text-blue-600 hidden sm:block flex-shrink-0"
                    ></app-icon>
                  }
                  <span class="truncate">{{
                    breadcrumbData.current.label
                  }}</span>
                </span>
              </div>
            }
            <!-- Antes <h1>. Bajado a <h2> en C.1 — el H1 de página vive
                 en app-sticky-header (lo emite cada vista privada que
                 lo usa). El nombre del módulo no es título de página;
                 dejarlo como <h1> duplicaba el landmark en todas las
                 vistas y rompía la regla "una sola H1 por página".
                 Si querés revertirlo, primero agregale un H1 propio a
                 cada vista privada que NO use sticky-header (ej. las
                 páginas de price-tiers) — antes el shell tapaba esa
                 ausencia pero a costa de un heading semánticamente
                 incorrecto. -->
            <h2
              class="text-sm sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 m-0 leading-none tracking-tight block truncate"
            >
              {{ breadcrumb()?.title || title() }}
            </h2>
          </div>
        </div>

        <!-- Notifications + User Dropdown -->
        <div class="flex-shrink-0 flex items-center gap-2">
          <!-- Scope Chips (ORG_ADMIN only, when authenticated) -->
          @if (show_scope_chip()) {
            @if (scopes_match()) {
              <!-- Combined chip when operating === fiscal -->
              <!-- Mobile: icon-only -->
              <button
                type="button"
                (click)="onScopeChipClick()"
                class="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo operativo y fiscal: ' +
                  scope_label() +
                  '. Cambiar configuración.'
                "
                [title]="'Modo: ' + scope_label()"
              >
                <app-icon
                  [name]="is_org_scope() ? 'building' : 'store'"
                  [size]="20"
                  [class]="
                    is_org_scope() ? 'text-blue-600' : 'text-slate-600'
                  "
                ></app-icon>
              </button>
              <!-- Desktop: icon + text via app-badge -->
              <button
                type="button"
                (click)="onScopeChipClick()"
                class="hidden md:inline-flex items-center justify-center min-h-[44px] px-1 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo operativo y fiscal: ' +
                  scope_label() +
                  '. Cambiar configuración.'
                "
                [title]="'Modo operativo y fiscal coinciden'"
              >
                <app-badge
                  [variant]="is_org_scope() ? 'info' : 'neutral'"
                  size="sm"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon
                      [name]="is_org_scope() ? 'building' : 'store'"
                      [size]="14"
                    ></app-icon>
                    <span>Modo: {{ scope_label() }}</span>
                  </span>
                </app-badge>
              </button>
            } @else {
              <!-- Two chips when operating and fiscal differ -->
              <!-- Operating: Mobile -->
              <button
                type="button"
                (click)="onScopeChipClick()"
                class="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo operativo: ' + scope_label() + '. Cambiar configuración.'
                "
                [title]="'Op: ' + scope_label()"
              >
                <app-icon
                  [name]="is_org_scope() ? 'building' : 'store'"
                  [size]="20"
                  [class]="is_org_scope() ? 'text-blue-600' : 'text-slate-600'"
                ></app-icon>
              </button>
              <!-- Operating: Desktop -->
              <button
                type="button"
                (click)="onScopeChipClick()"
                class="hidden md:inline-flex items-center justify-center min-h-[44px] px-1 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo operativo: ' + scope_label() + '. Cambiar configuración.'
                "
                [title]="'Cambiar modo operativo'"
              >
                <app-badge
                  [variant]="is_org_scope() ? 'info' : 'neutral'"
                  size="sm"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon
                      [name]="is_org_scope() ? 'building' : 'store'"
                      [size]="14"
                    ></app-icon>
                    <span>Op: {{ scope_label() }}</span>
                  </span>
                </app-badge>
              </button>
              <!-- Fiscal: Mobile -->
              <button
                type="button"
                (click)="onFiscalChipClick()"
                class="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo fiscal: ' + fiscal_label() + '. Cambiar configuración.'
                "
                [title]="'Fis: ' + fiscal_label()"
              >
                <app-icon
                  [name]="is_org_fiscal() ? 'landmark' : 'receipt'"
                  [size]="20"
                  [class]="is_org_fiscal() ? 'text-emerald-600' : 'text-slate-600'"
                ></app-icon>
              </button>
              <!-- Fiscal: Desktop -->
              <button
                type="button"
                (click)="onFiscalChipClick()"
                class="hidden md:inline-flex items-center justify-center min-h-[44px] px-1 rounded-lg transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/10 border-0 bg-transparent cursor-pointer"
                [attr.aria-label]="
                  'Modo fiscal: ' + fiscal_label() + '. Cambiar configuración.'
                "
                [title]="'Cambiar modo fiscal'"
              >
                <app-badge
                  [variant]="is_org_fiscal() ? 'success' : 'neutral'"
                  size="sm"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon
                      [name]="is_org_fiscal() ? 'landmark' : 'receipt'"
                      [size]="14"
                    ></app-icon>
                    <span>Fis: {{ fiscal_label() }}</span>
                  </span>
                </app-badge>
              </button>
            }
          }
          <app-help-search-overlay></app-help-search-overlay>
          <app-notifications-dropdown></app-notifications-dropdown>
          <app-user-dropdown
            (closeDropdown)="onDropdownClose()"
          ></app-user-dropdown>
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      /* Alto simétrico con la cabecera-logo del sidebar (--admin-header-h).
         Antes medía 84px por DOS cinturones de padding apilados: el propio
         (regla global \`header, nav { padding: .5rem .25rem }\` de styles.scss,
         pensada para móvil pero sin media query) más el \`md:p-2\` del div
         interno. Aquí se anula solo el vertical del global — el horizontal se
         conserva — y el alto pasa a decidirlo el token, no la suma accidental.
         La diferencia (12px) se devuelve como padding-top del outlet en cada
         layout admin, no como margin-bottom aquí: así el hueco pertenece al
         contenedor con scroll y se va con el contenido al desplazar, en vez de
         quedar clavado bajo el header. Los banners intermedios (suscripción,
         fiscal, arribo) tampoco quedan empujados por un margen que no es suyo.
         Va en el componente y no en styles.scss porque app-header solo lo usan
         los tres layouts admin: un dueño por elemento evita la carrera de
         especificidad contra el preset glass, que también pinta este <header>. */
      :host > header {
        display: flex;
        align-items: center;
        min-height: var(--admin-header-h);
        padding-block: 0;
      }

      /* El div interno era quien definía el ancho al ser el único hijo en flujo
         normal; con el header en flex hay que devolvérselo explícitamente. */
      :host > header > div {
        flex: 1;
        min-width: 0;
      }

      .mobile-logo-container {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
      }

      .mobile-logo {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .mobile-logo-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          var(--color-primary-dark, var(--color-primary)) 100%
        );
        color: white;
      }
    `,
  ],
})
export class HeaderComponent {
  // --- Inputs ---
  readonly title = input<string>('Panel Principal');

  // --- Outputs ---
  readonly toggleSidebar = output<void>();

  // --- Dependencies ---
  private readonly breadcrumbService = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly globalFacade = inject(GlobalFacade);
  private readonly configFacade = inject(ConfigFacade);
  private readonly authFacade = inject(AuthFacade);

  // --- Observables (async pipe compatible con Zoneless) ---
  readonly breadcrumb$: Observable<{
    /** Cadena completa de padres, desde el más externo al más cercano.
     *  Espeja el shape que `BreadcrumbService.breadcrumb` ya publica; sin
     *  declararlo aquí el consumidor no puede leer `parents` aunque el
     *  servicio lo emita en runtime. */
    parents?: BreadcrumbItem[];
    /** Último padre (= parents[parents.length - 1]). Backward compat. */
    parent?: BreadcrumbItem;
    current: BreadcrumbItem;
    title: string;
  }> = this.breadcrumbService.breadcrumb$;

  // --- Signal-based properties ---
  readonly breadcrumb = toSignal(this.breadcrumb$, { initialValue: null! });

  // --- Derived brand state ---
  /**
   * QUI-289 — antes eran `signal` planos seteados UNA vez en el constructor vía
   * `loadStoreBranding()`. En zoneless eso captura el instante-cero (el
   * `toSignal` de NgRx todavía en `initialValue: null`) y nunca recalcula, así
   * que el header móvil se quedaba con el logo monocromo aunque la tienda
   * tuviera el suyo — y no reflejaba un cambio de logo hasta recargar.
   *
   * La fuente de verdad es `authFacade.userStore()`, la misma que usa el
   * sidebar desktop (`store-admin-layout.storeLogo`); el branding del tenant
   * queda como respaldo cuando el snapshot aún no trae logo.
   */
  readonly storeLogo = computed<string | null>(() => {
    const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
    if (domainConfig?.isMainVendixDomain) return 'vlogo.png';

    const ownLogo =
      this.authFacade.userStore()?.logo_url ||
      this.globalFacade.brandingContext()?.logo?.url ||
      null;
    if (ownLogo) return ownLogo;

    // Fallback monocromo sólo dentro de un app type de tienda; ORG_ADMIN y
    // SUPER_ADMIN conservan su icono genérico.
    const appType = this.authFacade.selectedAppType();
    return appType === 'STORE_ADMIN' ||
      appType === 'STORE_ECOMMERCE' ||
      appType === 'STORE_LANDING'
      ? 'vlogomono.png'
      : null;
  });

  readonly storeName = computed<string | null>(
    () => this.authFacade.userStoreName() ?? null,
  );

  // --- Operating scope chip signals (ORG_ADMIN only) ---
  /**
   * True when the active app context is ORG_ADMIN. The header is shared with
   * STORE_ADMIN and SUPER_ADMIN layouts, so the scope chip must be gated.
   */
  private readonly is_org_admin = computed(
    () => this.authFacade.selectedAppType() === 'ORG_ADMIN',
  );
  /** True when current operating_scope === 'ORGANIZATION' (else STORE). */
  readonly is_org_scope = computed(
    () => this.authFacade.operatingScope() === 'ORGANIZATION',
  );
  /** Short label shown in the desktop badge: 'ORG' or 'STORE'. */
  readonly scope_label = computed(() =>
    this.is_org_scope() ? 'ORG' : 'STORE',
  );
  /** True when current fiscal_scope === 'ORGANIZATION' (else STORE). */
  readonly is_org_fiscal = computed(
    () => this.authFacade.fiscalScope() === 'ORGANIZATION',
  );
  /** Short label shown in the fiscal desktop badge: 'ORG' or 'STORE'. */
  readonly fiscal_label = computed(() =>
    this.is_org_fiscal() ? 'ORG' : 'STORE',
  );
  /**
   * True when operating_scope === fiscal_scope. Drives the smart-collapse:
   * a single chip when modes match, two chips when they diverge.
   */
  readonly scopes_match = computed(
    () => this.authFacade.operatingScope() === this.authFacade.fiscalScope(),
  );
  /**
   * Show chip only when authenticated and inside ORG_ADMIN. Avoids leaking
   * the org scope chip into STORE_ADMIN, SUPER_ADMIN, or public/auth screens.
   */
  readonly show_scope_chip = computed(
    () => this.authFacade.isAuthenticated() && this.is_org_admin(),
  );

  onDropdownClose(): void {
    // Lógica adicional cuando se cierra el dropdown si es necesario
  }

  navigateToUrl(url: string): void {
    this.router.navigateByUrl(url);
  }

  /**
   * Navigate to the operating-scope settings page. Only callable from
   * ORG_ADMIN since the chip is gated by `show_scope_chip()`.
   */
  onScopeChipClick(): void {
    this.router.navigate(['/admin/settings/operating-scope']);
  }

  /**
   * Navigate to the fiscal-scope settings page. Only callable from
   * ORG_ADMIN since the chip is gated by `show_scope_chip()`.
   */
  onFiscalChipClick(): void {
    this.router.navigate(['/admin/settings/fiscal-scope']);
  }
}
