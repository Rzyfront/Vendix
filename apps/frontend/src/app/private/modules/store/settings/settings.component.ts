import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../../../../app/shared/components/index';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    IconComponent,
  ],
  template: `
    <div class="flex h-screen bg-gray-50">
      <!-- Sidebar Navigation -->
      <div class="w-64 bg-white shadow-sm border-r border-gray-200">
        <div class="p-6">
          <h2 class="text-lg font-semibold text-gray-900 mb-6">Settings</h2>
          <nav class="space-y-1">
            <a
              routerLink="general"
              routerLinkActive="bg-blue-50 text-blue-700 border-r-2 border-blue-700"
              class="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <app-icon name="settings" [size]="16" class="mr-3"></app-icon>
              General
            </a>
            <a
              routerLink="payments"
              routerLinkActive="bg-blue-50 text-blue-700 border-r-2 border-blue-700"
              class="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <app-icon name="credit-card" [size]="16" class="mr-3"></app-icon>
              Payment Methods
            </a>
            <a
              routerLink="appearance"
              routerLinkActive="bg-blue-50 text-blue-700 border-r-2 border-blue-700"
              class="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <app-icon name="palette" [size]="16" class="mr-3"></app-icon>
              Appearance
            </a>
            <a
              routerLink="security"
              routerLinkActive="bg-blue-50 text-blue-700 border-r-2 border-blue-700"
              class="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <app-icon name="shield" [size]="16" class="mr-3"></app-icon>
              Security
            </a>
          </nav>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 overflow-auto">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class SettingsComponent {}
