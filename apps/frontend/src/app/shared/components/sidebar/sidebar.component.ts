import { Component, Input, Renderer2, OnDestroy, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { TooltipComponent } from '../tooltip/tooltip.component';

export interface MenuItem {
  label: string;
  icon: string;
  iconSize?: number | string;
  route?: string;
  children?: MenuItem[];
  badge?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, TooltipComponent],
  template: `
    <!-- Mobile Backdrop -->
    <div
      *ngIf="isMobile && isMobileOpen"
      class="sidebar-backdrop"
      [class.sidebar-backdrop-open]="isMobileOpen"
      (click)="closeMobileSidebar()"
      aria-hidden="true"
    ></div>

    <!-- Sidebar -->
    <aside
      [class]="getSidebarClasses()"
      [attr.aria-hidden]="isMobile && !isMobileOpen ? 'true' : null"
      [attr.aria-label]="isMobile ? 'Mobile navigation sidebar' : 'Desktop navigation sidebar'"
      [attr.inert]="isMobile && !isMobileOpen ? 'true' : null"
      role="navigation"
    >
      <!-- Mobile Close Button -->
      <button
        *ngIf="isMobile"
        class="sidebar-mobile-close"
        (click)="closeMobileSidebar()"
        aria-label="Close sidebar"
      >
        <app-icon name="x" [size]="20"></app-icon>
      </button>

      <!-- Logo Section -->
      <div class="sidebar-header">
        <div class="logo-container">
          <app-icon
            name="store"
            [size]="20"
            class="text-primary-foreground"
          ></app-icon>
        </div>
        <div class="logo-text-container">
          <h1 class="org-name">{{ title }}</h1>
          <div class="vlink-container">
            <a
              [href]="'/' + vlink"
              target="_blank"
              rel="noopener noreferrer"
              class="vlink"
            >
              <span class="truncate">{{ vlink }}</span>
              <app-icon name="link-2" [size]="12"></app-icon>
            </a>
            <app-tooltip
              class="vlink-tooltip"
              position="right"
              color="primary"
              size="sm"
            >
              {{ vlink }} commerce
            </app-tooltip>
          </div>
        </div>
      </div>

      <!-- Menu Items -->
      <nav class="menu-wrapper">
        <ul class="menu-list">
          <li *ngFor="let item of menuItems">
            <ng-container *ngIf="!item.children">
              <a
                [routerLink]="item.route"
                routerLinkActive="active"
                #rla="routerLinkActive"
                [class.active]="rla.isActive"
                class="menu-item"
                (click)="onMenuItemClick()"
              >
                <app-icon
                  [name]="item.icon"
                  [size]="item.iconSize || 20"
                  class="flex-shrink-0"
                ></app-icon>
                <span class="menu-text">{{ item.label }}</span>
                <span *ngIf="item.badge" class="badge">{{ item.badge }}</span>
              </a>
            </ng-container>

            <ng-container *ngIf="item.children">
              <button (click)="toggleSubmenu(item.label)" class="menu-item">
                <app-icon
                  [name]="item.icon"
                  [size]="item.iconSize || 20"
                  class="flex-shrink-0"
                ></app-icon>
                <span class="menu-text">{{ item.label }}</span>
                <app-icon
                  name="chevron-right"
                  [size]="16"
                  class="chevron"
                  [class.rotated]="isSubmenuOpen(item.label)"
                ></app-icon>
              </button>
              <ul class="submenu" [class.open]="isSubmenuOpen(item.label)">
                <li *ngFor="let child of item.children" class="submenu-item">
                  <a
                    [routerLink]="child.route"
                    routerLinkActive="active"
                    #rlaChild="routerLinkActive"
                    [class.active]="rlaChild.isActive"
                    (click)="onMenuItemClick()"
                  >
                    <span>{{ child.label }}</span>
                  </a>
                </li>
              </ul>
            </ng-container>
          </li>
        </ul>
      </nav>
    </aside>
  `,
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent implements OnDestroy, AfterViewInit {
  @Input() menuItems: MenuItem[] = [];
  @Input() title: string = 'Vendix Corp';
  @Input() vlink: string = 'vlink-slug';
  @Input() collapsed: boolean = false;
  @Input() isOpen: boolean = false;

  isMobile = false;
  isMobileOpen = false;
  private openSubmenus: Set<string> = new Set();
  private resizeListener: () => void;
  private documentClickListener?: () => void;
  private keydownListener?: () => void;
  private focusableElements: HTMLElement[] = [];

  constructor(private renderer: Renderer2, private elementRef: ElementRef, private cdr: ChangeDetectorRef) {
    // Initialize mobile detection
    this.checkMobile();
    this.resizeListener = this.renderer.listen('window', 'resize', () => {
      this.checkMobile();
    });
  }

  ngAfterViewInit() {
    // Setup focusable elements for accessibility
    this.updateFocusableElements();
  }

  ngOnDestroy() {
    if (this.resizeListener) {
      this.resizeListener();
    }
    this.removeEventListeners();
    this.removeBodyScrollLock();
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
    const sidebarElement = this.elementRef.nativeElement.querySelector('.sidebar');
    if (!sidebarElement) return;

    const focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ];

    this.focusableElements = Array.from(
      sidebarElement.querySelectorAll(focusableSelectors.join(', '))
    ) as HTMLElement[];
  }

  private checkMobile() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 768;

    // Close mobile sidebar if switching from mobile to desktop
    if (wasMobile && !this.isMobile && this.isMobileOpen) {
      this.closeMobileSidebar();
    }
  }

  getSidebarClasses(): string {
    const classes = ['sidebar'];

    if (this.collapsed) {
      classes.push('collapsed');
    }

    if (this.isMobile) {
      classes.push('sidebar-mobile');
      if (this.isMobileOpen) {
        classes.push('sidebar-mobile-open');
      }
    }

    return classes.join(' ');
  }

  toggleSidebar() {
    if (this.isMobile) {
      this.isMobileOpen ? this.closeMobileSidebar() : this.openMobileSidebar();
    }
    // For desktop, the collapsed state is controlled by the parent
  }

  openMobileSidebar() {
    if (!this.isMobile) return;

    this.isMobileOpen = true;

    // Forzar detección de cambios de Angular
    this.cdr.detectChanges();

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

  closeMobileSidebar() {
    if (!this.isMobileOpen) return;

    this.isMobileOpen = false;
    this.removeBodyScrollLock();
    this.removeEventListeners();

    // Return focus to the trigger button (hamburger menu)
    setTimeout(() => {
      const triggerButton = document.querySelector('[aria-label*="menu"], button[app-icon="menu"]') as HTMLElement;
      if (triggerButton) {
        triggerButton.focus();
      }
    }, 100);
  }

  private setupEventListeners() {
    // Remove existing listeners first
    this.removeEventListeners();

    // Click outside listener
    this.documentClickListener = this.renderer.listen('document', 'click', this.onDocumentClick.bind(this));

    // Keyboard navigation listener
    this.keydownListener = this.renderer.listen('document', 'keydown', this.onKeydown.bind(this));
  }

  private onDocumentClick(event: MouseEvent) {
    const sidebar = this.elementRef.nativeElement.querySelector('.sidebar');
    const target = event.target as HTMLElement;

    // Close if clicking outside the sidebar
    if (sidebar && !sidebar.contains(target) && this.isMobileOpen) {
      this.closeMobileSidebar();
    }
  }

  private onKeydown(event: KeyboardEvent) {
    if (!this.isMobileOpen) return;

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
    const lastElement = this.focusableElements[this.focusableElements.length - 1];

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

  onMenuItemClick() {
    // Close mobile sidebar when menu item is clicked
    if (this.isMobile) {
      setTimeout(() => {
        this.closeMobileSidebar();
      }, 150); // Small delay to allow navigation to start
    }
  }

  toggleSubmenu(menuLabel: string) {
    if (this.openSubmenus.has(menuLabel)) {
      this.openSubmenus.delete(menuLabel);
    } else {
      this.openSubmenus.add(menuLabel);
    }
  }

  isSubmenuOpen(menuLabel: string): boolean {
    return this.openSubmenus.has(menuLabel);
  }
}
