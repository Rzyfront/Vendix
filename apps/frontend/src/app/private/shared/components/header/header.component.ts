import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="bg-white border-b px-6 py-4" [style]="{ 'border-color': 'var(--border)' }">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <!-- Toggle Sidebar Button -->
          <button (click)="toggleSidebar.emit()" 
                  class="hover:bg-gray-100 p-2 rounded-lg transition-colors" 
                  [style]="{ 'color': 'var(--text)' }">
            <i class="fas fa-bars text-lg"></i>
          </button>
          
          <!-- Breadcrumb -->
          <div class="flex flex-col">
            <div class="flex items-center gap-2 text-sm" [style]="{ 'color': 'var(--secondary)' }">
              <span>{{ breadcrumb?.parent || 'Pages' }}</span>
              <i class="fas fa-chevron-right text-xs"></i>
              <span [style]="{ 'color': 'var(--text)' }">{{ breadcrumb?.current || 'Dashboard' }}</span>
            </div>
            <h1 class="text-2xl font-bold mt-1" [style]="{ 'color': 'var(--text)' }">{{ title }}</h1>
          </div>
        </div>
        
        <!-- Clean user badge in top right corner -->
        <div class="flex items-center gap-3">
          <div class="text-right">
            <p class="text-sm font-medium" [style]="{ 'color': 'var(--text)' }">{{ user?.name || 'Usuario' }}</p>
            <p class="text-xs" [style]="{ 'color': 'var(--secondary)' }">{{ user?.role || 'Administrador' }}</p>
          </div>
          <div class="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-white" 
               [style]="{ 'background-color': 'var(--primary)' }">
            {{ user?.initials || 'US' }}
          </div>
        </div>
      </div>
    </header>
  `,
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  @Input() title: string = 'Dashboard';
  @Input() breadcrumb?: { parent: string; current: string };
  @Input() user?: { name: string; role: string; initials: string };
  @Output() toggleSidebar = new EventEmitter<void>();
}