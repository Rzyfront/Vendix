import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Subscription, Observable } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import { UserDropdownComponent } from '../user-dropdown/user-dropdown.component';

import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { BreadcrumbItem } from '../../../core/services/breadcrumb.service';
import { GlobalFacade } from '../../../core/store/global.facade';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    UserDropdownComponent,
  ],
  template: `
    <header
      class="bg-transparent border-b-0 sticky top-0 backdrop-blur-md text-slate-900 relative z-[150]"
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
              <img
                *ngIf="storeLogo"
                [src]="storeLogo"
                [alt]="storeName || 'Logo'"
                class="mobile-logo"
              />
              <div *ngIf="!storeLogo" class="mobile-logo-placeholder">
                <app-icon name="store" [size]="18"></app-icon>
              </div>
            </div>
            <app-icon
              name="chevron-right"
              [size]="14"
              class="text-slate-400"
            ></app-icon>
          </button>

          <!-- Dynamic Breadcrumb -->
          <div class="flex flex-col gap-0 min-w-0 flex-1">
            <div
              class="flex items-center gap-1 sm:gap-2 flex-nowrap overflow-hidden"
              *ngIf="breadcrumb$ | async as breadcrumbData"
            >
              <ng-container *ngIf="breadcrumbData.parent">
                <a
                  *ngIf="breadcrumbData.parent.url"
                  [routerLink]="breadcrumbData.parent.url"
                  class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 no-underline transition-colors duration-200 hover:text-blue-600 min-w-0"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70 hidden sm:block flex-shrink-0"
                  ></app-icon>
                  <span class="truncate">{{
                    breadcrumbData.parent.label
                  }}</span>
                </a>
                <span
                  *ngIf="!breadcrumbData.parent.url"
                  class="flex items-center gap-1 text-[10px] sm:text-xs font-medium text-slate-600 min-w-0"
                >
                  <app-icon
                    *ngIf="breadcrumbData.parent.icon"
                    [name]="breadcrumbData.parent.icon"
                    [size]="14"
                    class="opacity-70 hidden sm:block flex-shrink-0"
                  ></app-icon>
                  <span class="truncate">{{
                    breadcrumbData.parent.label
                  }}</span>
                </span>
                <span
                  class="text-slate-600 opacity-70 mx-0.5 text-[10px] sm:text-xs font-normal flex-shrink-0"
                  >/</span
                >
              </ng-container>
              <span
                class="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-slate-900 min-w-0"
              >
                <app-icon
                  *ngIf="breadcrumbData.current.icon"
                  [name]="breadcrumbData.current.icon"
                  [size]="14"
                  class="text-blue-600 hidden sm:block flex-shrink-0"
                ></app-icon>
                <span class="truncate">{{ breadcrumbData.current.label }}</span>
              </span>
            </div>
            <h1
              class="text-sm sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 m-0 leading-none tracking-tight block truncate"
            >
              {{ (breadcrumb$ | async)?.title || title }}
            </h1>
          </div>
        </div>

        <!-- User Dropdown -->
        <div class="flex-shrink-0">
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
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() title: string = 'Panel Principal';
  @Input() breadcrumb: any = {};
  @Input() user: any = {};
  @Output() toggleSidebar = new EventEmitter<void>();

  private globalFacade = inject(GlobalFacade);

  breadcrumb$: Observable<{
    parent?: BreadcrumbItem;
    current: BreadcrumbItem;
    title: string;
  }>;
  private subscription?: Subscription;

  // Store branding
  storeLogo: string | null = null;
  storeName: string | null = null;

  constructor(
    private breadcrumbService: BreadcrumbService,
    private router: Router,
  ) {
    // Inicializar el observable del breadcrumb en el constructor
    this.breadcrumb$ = this.breadcrumbService.breadcrumb$;
  }

  ngOnInit() {
    // Suscribirse a cambios en el breadcrumb para actualizar dinámicamente
    this.subscription = this.breadcrumb$.subscribe((breadcrumb) => {
      // Opcional: Puedes agregar lógica adicional aquí si necesitas
      // reaccionar a cambios en el breadcrumb
    });

    // Cargar branding de la tienda para el logo mobile
    this.loadStoreBranding();
  }

  private loadStoreBranding(): void {
    const brandingContext = this.globalFacade.getBrandingContext();
    if (brandingContext?.logo?.url) {
      this.storeLogo = brandingContext.logo.url;
    }

    const userContext = this.globalFacade.getUserContext();
    if (userContext?.store?.name) {
      this.storeName = userContext.store.name;
    }
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  onDropdownClose() {
    // Puedes agregar lógica cuando se cierra el dropdown si es necesario
  }

  navigateToUrl(url: string) {
    this.router.navigateByUrl(url);
  }
}
