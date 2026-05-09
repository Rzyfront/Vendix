import {
  Component,
  input,
  output,
  signal,
  effect,
  inject,
  DestroyRef,
  Renderer2,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { TooltipComponent } from '../tooltip/tooltip.component';
import { BadgeComponent } from '../badge/badge.component';

const DEFAULT_LOCKED_BADGE = 'ORG';
const DEFAULT_LOCKED_TOOLTIP = 'Disponible en modo ORGANIZATION';
const OPERATING_SCOPE_ROUTE = '/admin/settings/operating-scope';

export interface MenuItem {
  label: string;
  icon: string;
  iconSize?: number | string;
  route?: string;
  queryParams?: Record<string, string>;
  children?: MenuItem[];
  badge?: string;
  action?: (item: MenuItem) => void;
  alwaysVisible?: boolean;
  requiresFeature?: string;
  /**
   * Restricts this menu item to organizations operating under the given scope.
   * - 'STORE': only visible when the org operates per-store.
   * - 'ORGANIZATION': only visible when the org operates consolidated at org level.
   * Omitted ⇒ visible regardless of operating_scope.
   */
  requiredOperatingScope?: 'STORE' | 'ORGANIZATION';
  /**
   * When true and the current operating scope does NOT match `requiredOperatingScope`,
   * the item is shown as disabled/locked instead of being filtered out.
   * Defaults to false (item is hidden when scope mismatches).
   */
  showLocked?: boolean;
  /**
   * Optional badge text shown next to the label when the item is locked.
   * Defaults visually to 'ORG' when omitted.
   */
  lockedBadge?: string;
  /**
   * Optional tooltip copy displayed when hovering a locked item.
   * Defaults visually to 'Disponible en modo ORGANIZATION' when omitted.
   */
  lockedTooltip?: string;
  /**
   * Internal metadata flag set by `MenuFilterService` when the item is rendered
   * in locked state (scope mismatch + showLocked === true). Consumers should
   * treat this as read-only — it is not meant to be set by config sites.
   */
  _locked?: boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, IconComponent, TooltipComponent, BadgeComponent],
  template: `
    <!-- Mobile Backdrop -->
    @if (isMobile() && isMobileOpen()) {
      <div
        class="sidebar-backdrop"
        [class.sidebar-backdrop-open]="isMobileOpen()"
        (click)="closeMobileSidebar()"
        aria-hidden="true"
      ></div>
    }

    <!-- Sidebar -->
    <aside
      [class]="getSidebarClasses()"
      [attr.aria-hidden]="isMobile() && !isMobileOpen() ? 'true' : null"
      [attr.aria-label]="
        isMobile() ? 'Mobile navigation sidebar' : 'Desktop navigation sidebar'
      "
      [attr.inert]="isMobile() && !isMobileOpen() ? 'true' : null"
      role="navigation"
    >
      <!-- Mobile Close Button -->
      @if (isMobile()) {
        <button
          class="sidebar-mobile-close"
          (click)="closeMobileSidebar()"
          aria-label="Close sidebar"
        >
          <app-icon name="x" [size]="16"></app-icon>
        </button>
      }

      <!-- Logo Section -->
      <div class="sidebar-header">
        <div class="logo-container" [class.logo-placeholder]="!logoUrl()">
          @if (logoUrl()) {
            <img
              [src]="logoUrl()"
              alt="Store logo"
              class="w-full h-full object-contain"
            />
          } @else {
            <app-icon
              name="store"
              [size]="20"
              class="text-primary-foreground"
            ></app-icon>
          }
        </div>
        <div class="logo-text-container">
          <h1 class="org-name">{{ title() }}</h1>
          <div class="vlink-container">
            <a
              [href]="vlinkUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="vlink"
            >
              <span class="truncate">{{ vlink() }}</span>
              <app-icon name="link-2" [size]="12"></app-icon>
            </a>
            <app-tooltip
              class="vlink-tooltip"
              position="right"
              color="primary"
              size="sm"
              [visible]="showPromoTooltip()"
            >
              {{ showPromoTooltip() ? 'Descubre tu propio entorno personalizado' : vlink() + ' commerce' }}
            </app-tooltip>
          </div>
        </div>
      </div>

      <!-- Menu Items -->
      <nav class="menu-wrapper">
        <ul class="menu-list">
          @for (item of menuItems(); track item.label) {
            <li>
              @if (item._locked) {
                <!-- Locked item: render as a button that redirects to the
                     operating-scope settings page; visually disabled -->
                <button
                  type="button"
                  class="menu-item menu-item-locked opacity-60 cursor-not-allowed"
                  [title]="item.lockedTooltip || defaultLockedTooltip"
                  (click)="onLockedItemClick()"
                >
                  <app-icon
                    [name]="item.icon"
                    [size]="item.iconSize || 18"
                    class="flex-shrink-0"
                  ></app-icon>
                  <span class="menu-text">{{ item.label }}</span>
                  <app-badge variant="info" size="xs" badgeStyle="outline">
                    {{ item.lockedBadge || defaultLockedBadge }}
                  </app-badge>
                </button>
              } @else if (!item.children) {
                <a
                  [routerLink]="item.route"
                  [queryParams]="item.queryParams || null"
                  routerLinkActive="active"
                  #rla="routerLinkActive"
                  [class.active]="rla.isActive"
                  class="menu-item"
                  (click)="onMenuItemClick()"
                >
                  <app-icon
                    [name]="item.icon"
                    [size]="item.iconSize || 18"
                    class="flex-shrink-0"
                  ></app-icon>
                  <span class="menu-text">{{ item.label }}</span>
                  @if (item.badge) {
                    <span class="badge">{{ item.badge }}</span>
                  }
                </a>
              } @else {
                <button (click)="toggleSubmenu(item.label)" class="menu-item">
                  <app-icon
                    [name]="item.icon"
                    [size]="item.iconSize || 18"
                    class="flex-shrink-0"
                  ></app-icon>
                  <span class="menu-text">{{ item.label }}</span>
                  @if (item.badge) {
                    <span class="badge">{{ item.badge }}</span>
                  }
                  <app-icon
                    name="chevron-right"
                    [size]="14"
                    class="chevron"
                    [class.rotated]="isSubmenuOpen(item.label)"
                  ></app-icon>
                </button>
                <ul class="submenu" [class.open]="isSubmenuOpen(item.label)">
                  @for (child of item.children; track child.label) {
                    <li class="submenu-item">
                      @if (child._locked) {
                        <button
                          type="button"
                          class="submenu-item-button menu-item-locked opacity-60 cursor-not-allowed"
                          [title]="child.lockedTooltip || defaultLockedTooltip"
                          (click)="onLockedItemClick()"
                        >
                          <span>{{ child.label }}</span>
                          <app-badge variant="info" size="xs" badgeStyle="outline">
                            {{ child.lockedBadge || defaultLockedBadge }}
                          </app-badge>
                        </button>
                      } @else if (child.action) {
                        <button
                          (click)="child.action(child); onMenuItemClick()"
                          class="submenu-item-button"
                        >
                          <span>{{ child.label }}</span>
                          @if (child.badge) {
                            <span class="badge">{{ child.badge }}</span>
                          }
                        </button>
                      } @else {
                        <a
                          [routerLink]="child.route"
                          [queryParams]="child.queryParams || null"
                          routerLinkActive="active"
                          #rlaChild="routerLinkActive"
                          [class.active]="rlaChild.isActive"
                          (click)="onMenuItemClick()"
                        >
                          <span>{{ child.label }}</span>
                          @if (child.badge) {
                            <span class="badge">{{ child.badge }}</span>
                          }
                        </a>
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      </nav>

      <!-- Footer Section -->
      @if (showFooter()) {
        <div class="sidebar-footer">
          <ng-content select="[slot=footer]"></ng-content>
        </div>
      }
    </aside>
  `,
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent implements AfterViewInit {
  // --- Inputs ---
  readonly menuItems = input<MenuItem[]>([]);
  readonly title = input<string>('Vendix Corp');
  readonly vlink = input<string>('vlink-slug');
  readonly domainHostname = input<string | null>(null);
  readonly logoUrl = input<string | null>(null);
  readonly collapsed = input<boolean>(false);
  readonly isOpen = input<boolean>(false);
  readonly showFooter = input<boolean>(false);
  readonly isVendixDomain = input<boolean>(false);
  readonly shimmer = input<boolean>(false);

  // --- Outputs ---
  readonly expandSidebar = output<void>();

  // --- Dependencies ---
  private readonly renderer = inject(Renderer2);
  private readonly elementRef = inject(ElementRef);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // --- State signals ---
  readonly isMobile = signal(false);
  readonly isMobileOpen = signal(false);
  readonly showPromoTooltip = signal(false);

  // --- Locked-item defaults exposed to template ---
  protected readonly defaultLockedBadge = DEFAULT_LOCKED_BADGE;
  protected readonly defaultLockedTooltip = DEFAULT_LOCKED_TOOLTIP;

  // --- Private state ---
  private promoTooltipTimeout: any;
  private promoTooltipHideTimeout: any;
  private readonly openSubmenus = signal<Set<string>>(new Set());
  private resizeListener: () => void;
  private documentClickListener?: () => void;
  private keydownListener?: () => void;
  private focusableElements: HTMLElement[] = [];

  // Getter para construir la URL del vlink
  get vlinkUrl(): string {
    const hostname = this.domainHostname();
    if (hostname) {
      // Si tenemos un hostname de dominio, construir la URL completa
      const protocol = window.location.protocol; // http: o https:
      return `${protocol}//${hostname}`;
    }
    // Fallback a la ruta relativa original
    return '/' + this.vlink();
  }

  constructor() {
    // Initialize mobile detection
    this.checkMobile();
    this.resizeListener = this.renderer.listen('window', 'resize', () => {
      this.checkMobile();
    });

    // React to collapsed input changes: clear open submenus when collapsed
    effect(() => {
      if (this.collapsed()) {
        this.openSubmenus.set(new Set());
      }
    });

    // Cleanup on destroy
    this.destroyRef.onDestroy(() => {
      if (this.resizeListener) {
        this.resizeListener();
      }
      if (this.promoTooltipTimeout) {
        clearTimeout(this.promoTooltipTimeout);
      }
      if (this.promoTooltipHideTimeout) {
        clearTimeout(this.promoTooltipHideTimeout);
      }
      this.removeEventListeners();
      this.removeBodyScrollLock();
    });
  }

  ngAfterViewInit(): void {
    // Setup focusable elements for accessibility
    this.updateFocusableElements();

    // Auto-show promotional tooltip for Vendix domains
    if (this.isVendixDomain()) {
      this.showPromoTooltipOnMount();
    }
  }

  private showPromoTooltipOnMount(): void {
    this.promoTooltipTimeout = setTimeout(() => {
      this.showPromoTooltip.set(true);

      this.promoTooltipHideTimeout = setTimeout(() => {
        this.showPromoTooltip.set(false);
      }, 5000);
    }, 200);
  }

  private removeEventListeners() {
    if (this.documentClickListener) {
      this.documentClickListener();
      this.documentClickListener = undefined;
    }
    if (this.keydownListener) {
      this.keydownListener();
      this.keydownListener = undefined;
    }
  }

  private updateFocusableElements() {
    const sidebarElement =
      this.elementRef.nativeElement.querySelector('.sidebar');
    if (!sidebarElement) return;

    const focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];

    this.focusableElements = Array.from(
      sidebarElement.querySelectorAll(focusableSelectors.join(', ')),
    ) as HTMLElement[];
  }

  private checkMobile(): void {
    const wasMobile = this.isMobile();
    this.isMobile.set(window.innerWidth < 768);

    // Close mobile sidebar if switching from mobile to desktop
    if (wasMobile && !this.isMobile() && this.isMobileOpen()) {
      this.closeMobileSidebar();
    }
  }

  getSidebarClasses(): string {
    const classes = ['sidebar'];

    if (this.collapsed()) {
      classes.push('collapsed');
    }

    if (this.shimmer()) {
      classes.push('shimmer-active');
    }

    if (this.isMobile()) {
      classes.push('sidebar-mobile');
      if (this.isMobileOpen()) {
        classes.push('sidebar-mobile-open');
      }
    }

    return classes.join(' ');
  }

  toggleSidebarState(): void {
    if (this.isMobile()) {
      this.isMobileOpen() ? this.closeMobileSidebar() : this.openMobileSidebar();
    }
    // For desktop, the collapsed state is controlled by the parent
  }

  openMobileSidebar(): void {
    if (!this.isMobile()) return;

    this.isMobileOpen.set(true);
    this.addBodyScrollLock();

    // Delay setup of event listeners to avoid immediate triggering from event bubbling
    setTimeout(() => {
      this.setupEventListeners();
    }, 200);

    // Focus management: move focus to first focusable element
    setTimeout(() => {
      this.updateFocusableElements();
      if (this.focusableElements.length > 0) {
        this.focusableElements[0].focus();
      }
    }, 100);
  }

  closeMobileSidebar(): void {
    if (!this.isMobileOpen()) return;

    this.isMobileOpen.set(false);
    this.removeBodyScrollLock();
    this.removeEventListeners();

    // Return focus to the trigger button (hamburger menu)
    setTimeout(() => {
      const triggerButton = document.querySelector(
        '[aria-label*="menu"], button[app-icon="menu"]',
      ) as HTMLElement;
      if (triggerButton) {
        triggerButton.focus();
      }
    }, 100);
  }

  private setupEventListeners() {
    // Remove existing listeners first
    this.removeEventListeners();

    // Click outside listener
    this.documentClickListener = this.renderer.listen(
      'document',
      'click',
      this.onDocumentClick.bind(this),
    );

    // Keyboard navigation listener
    this.keydownListener = this.renderer.listen(
      'document',
      'keydown',
      this.onKeydown.bind(this),
    );
  }

  private onDocumentClick(event: MouseEvent): void {
    const sidebar = this.elementRef.nativeElement.querySelector('.sidebar');
    const target = event.target as HTMLElement;

    // Close if clicking outside the sidebar
    if (sidebar && !sidebar.contains(target) && this.isMobileOpen()) {
      this.closeMobileSidebar();
    }
  }

  private onKeydown(event: KeyboardEvent): void {
    if (!this.isMobileOpen()) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.closeMobileSidebar();
        break;
      case 'Tab':
        this.handleTabKey(event);
        break;
    }
  }

  private handleTabKey(event: KeyboardEvent) {
    if (this.focusableElements.length === 0) return;

    const firstElement = this.focusableElements[0];
    const lastElement =
      this.focusableElements[this.focusableElements.length - 1];

    if (event.shiftKey) {
      // Shift + Tab: go backwards
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: go forwards
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }

  private addBodyScrollLock() {
    this.renderer.addClass(document.body, 'sidebar-mobile-open');
  }

  private removeBodyScrollLock() {
    this.renderer.removeClass(document.body, 'sidebar-mobile-open');
  }

  onMenuItemClick(): void {
    // Close mobile sidebar when menu item is clicked
    if (this.isMobile()) {
      setTimeout(() => {
        this.closeMobileSidebar();
      }, 150); // Small delay to allow navigation to start
    }
  }

  /**
   * Handles clicks on locked menu items: navigates the user to the operating
   * scope settings page so they can upgrade/change scope, instead of taking
   * the original route. Mobile sidebar is closed alongside.
   */
  onLockedItemClick(): void {
    this.router.navigateByUrl(OPERATING_SCOPE_ROUTE);
    this.onMenuItemClick();
  }

  toggleSubmenu(menuLabel: string): void {
    // Auto-expand if collapsed and has children (PC only)
    if (this.collapsed() && !this.isMobile()) {
      this.expandSidebar.emit();
      // We want to open this submenu after expansion, so we add it.
      // The exclusive logic below will handle clearing others.
    }

    const current = this.openSubmenus();
    if (current.has(menuLabel)) {
      const next = new Set(current);
      next.delete(menuLabel);
      this.openSubmenus.set(next);
    } else {
      // Exclusive Accordion: Close all other submenus
      this.openSubmenus.set(new Set([menuLabel]));

      // Auto-navigate to first child with valid route
      this.navigateToFirstChild(menuLabel);
    }
  }

  private navigateToFirstChild(menuLabel: string): void {
    // Find the menu item by label
    const menuItem = this.menuItems().find((item) => item.label === menuLabel);

    if (!menuItem?.children?.length) {
      return;
    }

    // Find the first child that has a route (not an action)
    const firstChildWithRoute = menuItem.children.find(
      (child) => child.route && !child.action,
    );

    if (firstChildWithRoute?.route) {
      this.router.navigateByUrl(firstChildWithRoute.route);
    }
  }

  isSubmenuOpen(menuLabel: string): boolean {
    return this.openSubmenus().has(menuLabel);
  }
}
