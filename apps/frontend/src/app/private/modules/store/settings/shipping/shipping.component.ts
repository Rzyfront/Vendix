import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShippingMethodsComponent } from './components/shipping-methods/shipping-methods.component';
import { ShippingZonesComponent } from './components/shipping-zones/shipping-zones.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-shipping-layout',
  standalone: true,
  imports: [CommonModule, ShippingMethodsComponent, ShippingZonesComponent, IconComponent],
  template: `
    <div class="min-h-screen bg-[var(--color-background)]">
      <!-- Sticky Header: Stuck to top and rounded only at bottom -->
      <div class="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-[var(--color-border)] p-4 md:px-6 md:py-4 shadow-sm mb-6 rounded-b-xl">
        <div class="max-w-[1600px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center border border-[var(--color-primary)]/20">
              <app-icon name="truck" size="24" class="text-[var(--color-primary)]"></app-icon>
            </div>
            <div>
              <h1 class="text-xl font-bold text-[var(--color-text-primary)]">Configuración de Logística</h1>
              <p class="text-sm text-[var(--color-text-secondary)]">Gestiona métodos de envío, zonas de cobertura y tarifas.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-[1600px] mx-auto px-4 md:px-6 pb-12">
        <!-- Tabs -->
        <div class="flex items-center gap-2 bg-white/50 p-1 rounded-xl border border-[var(--color-border)] w-fit mb-8 backdrop-blur-sm">
          <button 
             (click)="activeTab = 'methods'" 
             [class.bg-white]="activeTab === 'methods'"
             [class.shadow-sm]="activeTab === 'methods'"
             [class.text-[var(--color-primary)]]="activeTab === 'methods'"
             class="px-6 py-2 rounded-lg font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all">
             Métodos de Envío
          </button>
          <button 
             (click)="activeTab = 'zones'"
             [class.bg-white]="activeTab === 'zones'"
             [class.shadow-sm]="activeTab === 'zones'"
             [class.text-[var(--color-primary)]]="activeTab === 'zones'"
             class="px-6 py-2 rounded-lg font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all">
             Zonas y Tarifas
          </button>
        </div>

        <!-- Content -->
        <div class="tab-content transition-all duration-300">
           <ng-container *ngIf="activeTab === 'methods'">
              <app-shipping-methods></app-shipping-methods>
           </ng-container>

           <ng-container *ngIf="activeTab === 'zones'">
              <app-shipping-zones></app-shipping-zones>
           </ng-container>
        </div>
      </div>
    </div>
  `
})
export class ShippingLayoutComponent {
  activeTab: 'methods' | 'zones' = 'methods';
}
