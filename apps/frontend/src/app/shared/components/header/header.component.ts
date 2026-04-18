import { Component, inject, input, output, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { IconComponent } from '../icon/icon.component';
import { UserDropdownComponent } from '../user-dropdown/user-dropdown.component';
import { NotificationsDropdownComponent } from '../notifications-dropdown/notifications-dropdown.component';
import { HelpSearchOverlayComponent } from '../help-search-overlay/help-search-overlay.component';

import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/services/breadcrumb.service';
import { GlobalFacade } from '../../../core/store/global.facade';
import { ConfigFacade } from '../../../core/store/config';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterModule,
    IconComponent,
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
            <h1
              class="text-sm sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 m-0 leading-none tracking-tight block truncate"
            >
              {{ breadcrumb()?.title || title() }}
            </h1>
          </div>
        </div>

        <!-- Notifications + User Dropdown -->
        <div class="flex-shrink-0 flex items-center gap-2">
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

  // --- Observables (async pipe compatible con Zoneless) ---
  readonly breadcrumb$: Observable<{
    parent?: BreadcrumbItem;
    current: BreadcrumbItem;
    title: string;
  }> = this.breadcrumbService.breadcrumb$;

  // --- Signal-based properties ---
  readonly breadcrumb = toSignal(this.breadcrumb$, { initialValue: null! });

  // --- State signals ---
  readonly storeLogo = signal<string | null>(null);
  readonly storeName = signal<string | null>(null);

  constructor() {
    this.loadStoreBranding();
  }

  private loadStoreBranding(): void {
    const brandingContext = this.globalFacade.getBrandingContext();
    if (brandingContext?.logo?.url) {
      this.storeLogo.set(brandingContext.logo.url);
    } else {
      const domainConfig = this.configFacade.getCurrentConfig()?.domainConfig;
      if (domainConfig?.isMainVendixDomain) {
        this.storeLogo.set('vlogo.png');
      }
    }

    const userContext = this.globalFacade.getUserContext();
    if (userContext?.store?.name) {
      this.storeName.set(userContext.store.name);
    }
  }

  onDropdownClose(): void {
    // Lógica adicional cuando se cierra el dropdown si es necesario
  }

  navigateToUrl(url: string): void {
    this.router.navigateByUrl(url);
  }
}
