import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ShippingService } from '../../services/shipping.service';
import { ShippingZone, ShippingZoneStats, ShippingMethod } from '../../interfaces/shipping.interface';
import { ShippingZoneModalComponent } from '../shipping-zone-modal/shipping-zone-modal.component';
import { ShippingRatesComponent } from '../shipping-rates/shipping-rates.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-superadmin-shipping-zones',
  standalone: true,
  imports: [CommonModule, IconComponent, ButtonComponent, ShippingZoneModalComponent, ShippingRatesComponent],
  template: `
    <div class="space-y-6">
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl p-6 border border-[var(--color-border)] shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-[var(--color-text-secondary)] mb-1">Total de Zonas</p>
              <p class="text-3xl font-bold text-[var(--color-text-primary)]">{{ stats?.total_zones || 0 }}</p>
            </div>
            <div class="w-12 h-12 bg-indigo-50 rounded-lg flex items-center justify-center">
              <app-icon name="map-pin" size="24" class="text-indigo-600"></app-icon>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-xl p-6 border border-[var(--color-border)] shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-[var(--color-text-secondary)] mb-1">Activas</p>
              <p class="text-3xl font-bold text-green-600">{{ stats?.active_zones || 0 }}</p>
            </div>
            <div class="w-12 h-12 bg-green-50 rounded-lg flex items-center justify-center">
              <app-icon name="check-circle" size="24" class="text-green-600"></app-icon>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-xl p-6 border border-[var(--color-border)] shadow-sm">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-[var(--color-text-secondary)] mb-1">Inactivas</p>
              <p class="text-3xl font-bold text-gray-600">{{ stats?.inactive_zones || 0 }}</p>
            </div>
            <div class="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center">
              <app-icon name="x-circle" size="24" class="text-gray-600"></app-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- Zones Grid -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-[var(--color-text-primary)]">Zonas de Envío del Sistema</h2>
          <p class="text-sm text-[var(--color-text-secondary)]">Define áreas geográficas disponibles para todas las tiendas.</p>
        </div>
        <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
          <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
          Nueva Zona
        </app-button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6" *ngIf="zones.length > 0; else emptyState">
        <div *ngFor="let zone of zones" class="bg-white rounded-2xl border border-[var(--color-border)] p-6 hover:shadow-lg transition-all group flex flex-col justify-between h-full">
          <div>
            <div class="flex justify-between items-start mb-4">
              <div class="flex items-center gap-3">
                 <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center border border-indigo-100">
                   <app-icon name="map-pin" size="20" class="text-indigo-600"></app-icon>
                 </div>
                 <div>
                   <h3 class="font-bold text-gray-900 leading-none">{{ zone.name }}</h3>
                   <span class="text-xs text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded mt-1 inline-block">Sistema</span>
                 </div>
              </div>
              <span [class]="zone.is_active ? 'text-green-600 bg-green-100 border-green-200' : 'text-gray-600 bg-gray-50 border-gray-200'"
                    class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border">
                {{ zone.is_active ? 'Activa' : 'Inactiva' }}
              </span>
            </div>

            <div class="space-y-4 mb-6">
              <div class="flex items-start gap-3">
                <app-icon name="globe" size="16" class="text-gray-400 mt-0.5"></app-icon>
                <div class="text-sm text-gray-600">
                  <span class="font-medium text-gray-900 block mb-0.5">Países</span>
                  <div class="line-clamp-2">{{ zone.countries.join(', ') }}</div>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <app-icon name="list" size="16" class="text-gray-400 mt-0.5"></app-icon>
                <div class="text-sm text-gray-600">
                  <span class="font-medium text-gray-900 block mb-0.5">Cobertura</span>
                  {{ zone.regions?.length ? zone.regions?.length + ' regiones seleccionadas' : 'Todas las regiones' }}
                </div>
              </div>
              <div class="flex items-start gap-3">
                <app-icon name="tag" size="16" class="text-gray-400 mt-0.5"></app-icon>
                <div class="text-sm text-gray-600">
                  <span class="font-medium text-gray-900 block mb-0.5">Tarifas Configuradas</span>
                  {{ zone._count?.shipping_rates || 0 }} tariffas
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 pt-4 border-t border-gray-100">
            <app-button (clicked)="openEditModal(zone)" variant="outline" size="sm" class="!text-xs">
              <app-icon name="edit" size="14" slot="icon" class="mr-1"></app-icon>
              Editar
            </app-button>
            <app-button (clicked)="openRatesModal(zone)" variant="primary" size="sm" class="!text-xs">
              <app-icon name="dollar-sign" size="14" slot="icon" class="mr-1"></app-icon>
              Tarifas
            </app-button>
            <app-button variant="ghost" size="sm" class="col-span-2 !text-xs !text-red-600 hover:!bg-red-50">
              <app-icon name="trash" size="14" slot="icon" class="mr-1"></app-icon>
              Eliminar Zona
            </app-button>
          </div>
        </div>
      </div>

      <ng-template #emptyState>
        <div class="py-20 text-center">
          <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-100">
            <app-icon name="map-pin" size="40" class="text-gray-300"></app-icon>
          </div>
          <h3 class="text-xl font-bold text-[var(--color-text-primary)]">Sin zonas de envío del sistema</h3>
          <p class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2">
            No hay zonas de envío del sistema configuradas. Crea zonas que estarán disponibles para todas las tiendas.
          </p>
        </div>
      </ng-template>

      <!-- MODAL -->
      <app-superadmin-shipping-zone-modal
        *ngIf="showModal"
        [zone]="selectedZone"
        (close)="closeModal()"
        (saved)="loadData()">
      </app-superadmin-shipping-zone-modal>

      <!-- RATES MODAL -->
      <app-superadmin-shipping-rates
        *ngIf="showRatesModal"
        [zone]="selectedZone"
        [methods]="methods"
        (close)="closeRatesModal()">
      </app-superadmin-shipping-rates>
    </div>
  `
})
export class ShippingZonesComponent implements OnInit {
  private shippingService = inject(ShippingService);

  zones: ShippingZone[] = [];
  stats?: ShippingZoneStats;
  methods: ShippingMethod[] = [];
  showModal = false;
  showRatesModal = false;
  selectedZone?: ShippingZone;

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.shippingService.getZones().subscribe(data => {
      this.zones = data;
    });
    this.shippingService.getZoneStats().subscribe(data => {
      this.stats = data;
    });
    // Load methods for rates modal
    this.shippingService.getMethods().subscribe(data => {
      this.methods = data;
    });
  }

  openCreateModal() {
    this.selectedZone = undefined;
    this.showModal = true;
  }

  openEditModal(zone: ShippingZone) {
    this.selectedZone = zone;
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.selectedZone = undefined;
  }

  openRatesModal(zone: ShippingZone) {
    this.selectedZone = zone;
    this.showRatesModal = true;
  }

  closeRatesModal() {
    this.showRatesModal = false;
    this.selectedZone = undefined;
  }
}
