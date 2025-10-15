import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export interface MenuItem {
  label: string;
  icon: string;
  route?: string;
  children?: MenuItem[];
  badge?: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <aside [class]="'sidebar ' + (collapsed ? 'collapsed' : '')" 
           [style]="{ 'border-color': 'var(--border)' }">
      <!-- Logo -->
      <div class="p-4 border-b flex items-center gap-3" [style]="{ 'border-color': 'var(--border)' }">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" 
             [style]="{ 'background-color': 'var(--primary)' }">
          <i class="fas fa-store text-white text-lg"></i>
        </div>
        <div class="logo-text">
          <h1 class="font-bold text-lg" [style]="{ 'color': 'var(--text)' }">Vendix Corp</h1>
          <span class="text-xs" [style]="{ 'color': 'var(--secondary)' }">{{ subtitle }}</span>
        </div>
      </div>
      
      <!-- Menu Items -->
      <nav class="flex-1 overflow-y-auto p-3">
        <ul class="space-y-1">
          <li *ngFor="let item of menuItems">
            <ng-container *ngIf="!item.children">
              <a [routerLink]="item.route" 
                 routerLinkActive="active"
                 class="menu-item flex items-center gap-3 px-3 py-2.5 rounded-lg"
                 [style]="{ 'color': 'var(--text)' }">
                <i [class]="item.icon + ' w-5 flex-shrink-0'"></i>
                <span class="menu-text flex-1">{{ item.label }}</span>
                <span *ngIf="item.badge" 
                      class="badge text-xs px-2 py-0.5 rounded-full text-white"
                      [style]="{ 'background-color': 'var(--secondary)' }">
                  {{ item.badge }}
                </span>
              </a>
            </ng-container>

            <ng-container *ngIf="item.children">
              <button (click)="toggleSubmenu(item.label)"
                      class="menu-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      [style]="{ 'color': 'var(--text)' }">
                <i [class]="item.icon + ' w-5 flex-shrink-0'"></i>
                <span class="menu-text flex-1 text-left">{{ item.label }}</span>
                <i class="fas fa-chevron-right chevron text-xs" 
                   [class.rotated]="isSubmenuOpen(item.label)"></i>
              </button>
              <ul [class]="'submenu ml-8 mt-1 space-y-1 ' + (isSubmenuOpen(item.label) ? 'open' : '')">
                <li *ngFor="let child of item.children">
                  <a [routerLink]="child.route" 
                     routerLinkActive="active"
                     class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-gray-50"
                     [style]="{ 'color': 'var(--secondary)' }">
                    <i class="fas fa-circle text-xs"></i>
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
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent {
  @Input() menuItems: MenuItem[] = [];
  @Input() subtitle: string = 'Admin Panel';
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