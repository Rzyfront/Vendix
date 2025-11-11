import { Component, Input } from '@angular/core';
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
    <aside [class]="'sidebar ' + (collapsed ? 'collapsed' : '')">
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
export class SidebarComponent {
  @Input() menuItems: MenuItem[] = [];
  @Input() title: string = 'Vendix Corp';
  @Input() vlink: string = 'vlink-slug';
  @Input() collapsed: boolean = false;

  private openSubmenus: Set<string> = new Set();

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
