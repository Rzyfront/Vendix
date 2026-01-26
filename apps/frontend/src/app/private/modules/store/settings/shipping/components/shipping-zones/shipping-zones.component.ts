import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShippingService } from '../../services/shipping.service';
import { ShippingZone } from '../../interfaces/shipping.interface';
import { ShippingZoneModalComponent } from '../shipping-zone-modal/shipping-zone-modal.component';
import { ShippingRatesComponent } from '../shipping-rates/shipping-rates.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-shipping-zones',
  standalone: true,
  imports: [CommonModule, ShippingZoneModalComponent, ShippingRatesComponent, IconComponent, ButtonComponent],
  template: `
    <div class="mt-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 class="text-lg font-bold text-[var(--color-text-primary)]">Zonas de Envío</h2>
          <p class="text-sm text-[var(--color-text-secondary)]">Define las áreas geográficas donde entregas y sus condiciones.</p>
        </div>
        <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
          <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
          Nueva Zona
        </app-button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div *ngFor="let zone of zones" class="bg-white rounded-2xl border border-[var(--color-border)] p-6 hover:shadow-lg transition-all group flex flex-col justify-between h-full">
          <div>
            <div class="flex justify-between items-start mb-4">
              <div class="flex items-center gap-3">
                 <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center border border-indigo-100">
                   <app-icon name="map-pin" size="20" class="text-indigo-600"></app-icon>
                 </div>
                 <h3 class="font-bold text-gray-900 leading-none">{{ zone.name }}</h3>
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
            </div>
          </div>

          <div class="flex items-center gap-2 pt-4 border-t border-[var(--color-border)]">
            <app-button (clicked)="openEditModal(zone)" variant="outline" size="sm" [fullWidth]="true" customClasses="!text-xs">
              Editar Zona
            </app-button>
            <app-button (clicked)="manageRates(zone)" variant="secondary" size="sm" [fullWidth]="true" customClasses="!text-xs">
               Ver Tarifas
            </app-button>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="zones.length === 0" class="col-span-full py-20 text-center bg-white rounded-2xl border-2 border-dashed border-[var(--color-border)]">
          <div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <app-icon name="map-pin" size="40" class="text-gray-300"></app-icon>
          </div>
          <h3 class="text-xl font-bold text-[var(--color-text-primary)]">No hay zonas configuradas</h3>
          <p class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2 text-sm">
            Crea zonas geográficas para poder aplicar diferentes tarifas de envío según el destino de tus clientes.
          </p>
          <app-button (clicked)="openCreateModal()" variant="outline" size="sm" class="mt-8">
            <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
            Crear mi primera zona
          </app-button>
        </div>
      </div>

      <!-- MODAL -->
      <app-shipping-zone-modal 
        *ngIf="showModal" 
        [zone]="selectedZone"
        (close)="closeModal()"
        (saved)="loadZones()">
      </app-shipping-zone-modal>

      <!-- RATES MANAGER -->
      <app-shipping-rates
        *ngIf="showRates"
        [zone]="rateZone"
        [methods]="availableMethods"
        (close)="closeRates()">
      </app-shipping-rates>
    </div>
  `
})
export class ShippingZonesComponent implements OnInit {
  private shippingService = inject(ShippingService);

  zones: ShippingZone[] = [];
  showModal = false;
  selectedZone?: ShippingZone;

  // Rates State
  showRates = false;
  rateZone?: ShippingZone;
  availableMethods: any[] = [];

  ngOnInit() {
    this.loadZones();
  }

  loadZones() {
    this.shippingService.getZones().subscribe(data => {
      this.zones = data;
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

  manageRates(zone: ShippingZone) {
    this.rateZone = zone;
    this.showRates = true;
    // Load methods if not loaded
    if (this.availableMethods.length === 0) {
      this.shippingService.getMethods().subscribe(m => this.availableMethods = m);
    }
  }

  closeRates() {
    this.showRates = false;
    this.rateZone = undefined;
  }

  closeModal() {
    this.showModal = false;
    this.selectedZone = undefined;
  }
}
