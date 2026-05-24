import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ShippingService } from '../../services/shipping.service';
import {
  ShippingZone,
  ShippingMethod,
} from '../../interfaces/shipping.interface';
import { ShippingZoneModalComponent } from '../shipping-zone-modal/shipping-zone-modal.component';
import { ShippingRatesComponent } from '../shipping-rates/shipping-rates.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-superadmin-shipping-zones',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    ShippingZoneModalComponent,
    ShippingRatesComponent,
  ],
  template: `
    <div class="space-y-6">
      <!-- Zones Grid -->
      <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h2 class="text-lg font-bold text-[var(--color-text-primary)]">
            Zonas de Envío del Sistema
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)]">
            Define áreas geográficas disponibles para todas las tiendas.
          </p>
        </div>
        <app-button (clicked)="openCreateModal()" variant="primary" size="sm">
          <app-icon name="plus" size="18" slot="icon" class="mr-2"></app-icon>
          Nueva Zona
        </app-button>
      </div>

      @if (loading()) {
        <div
          class="flex flex-col items-center justify-center py-20 text-gray-400 gap-3"
        >
          <app-icon name="loader-2" size="32" [spin]="true"></app-icon>
          <span class="text-sm font-medium italic">Cargando zonas...</span>
        </div>
      } @else if (zones().length > 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          @for (zone of zones(); track zone.id) {
            <div
              class="bg-white rounded-2xl border border-[var(--color-border)] p-6 hover:shadow-lg transition-all group flex flex-col justify-between h-full"
            >
              <div>
                <div class="flex justify-between items-start mb-4">
                  <div class="flex items-center gap-3">
                    <div
                      class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center border border-indigo-100"
                    >
                      <app-icon
                        name="map-pin"
                        size="20"
                        class="text-indigo-600"
                      ></app-icon>
                    </div>
                    <div>
                      <h3 class="font-bold text-gray-900 leading-none">
                        {{ zone.name }}
                      </h3>
                      <span
                        class="text-xs text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded mt-1 inline-block"
                        >Sistema</span
                      >
                    </div>
                  </div>
                  <span
                    [class]="
                      zone.is_active
                        ? 'text-green-600 bg-green-100 border-green-200'
                        : 'text-gray-600 bg-gray-50 border-gray-200'
                    "
                    class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border"
                  >
                    {{ zone.is_active ? 'Activa' : 'Inactiva' }}
                  </span>
                </div>
                <div class="space-y-4 mb-6">
                  <div class="flex items-start gap-3">
                    <app-icon
                      name="globe"
                      size="16"
                      class="text-gray-400 mt-0.5"
                    ></app-icon>
                    <div class="text-sm text-gray-600">
                      <span class="font-medium text-gray-900 block mb-0.5"
                        >Países</span
                      >
                      <div class="line-clamp-2">
                        {{ zone.countries.join(', ') }}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-start gap-3">
                    <app-icon
                      name="list"
                      size="16"
                      class="text-gray-400 mt-0.5"
                    ></app-icon>
                    <div class="text-sm text-gray-600">
                      <span class="font-medium text-gray-900 block mb-0.5"
                        >Cobertura</span
                      >
                      {{
                        zone.regions?.length
                          ? zone.regions?.length + ' regiones seleccionadas'
                          : 'Todas las regiones'
                      }}
                    </div>
                  </div>
                  <div class="flex items-start gap-3">
                    <app-icon
                      name="tag"
                      size="16"
                      class="text-gray-400 mt-0.5"
                    ></app-icon>
                    <div class="text-sm text-gray-600">
                      <span class="font-medium text-gray-900 block mb-0.5"
                        >Tarifas Configuradas</span
                      >
                      {{ zone._count?.shipping_rates || 0 }} tariffas
                    </div>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 pt-4 border-t border-gray-100">
                <app-button
                  (clicked)="openEditModal(zone)"
                  variant="outline"
                  size="sm"
                  class="!text-xs"
                >
                  <app-icon
                    name="edit"
                    size="14"
                    slot="icon"
                    class="mr-1"
                  ></app-icon>
                  Editar
                </app-button>
                <app-button
                  (clicked)="openRatesModal(zone)"
                  variant="primary"
                  size="sm"
                  class="!text-xs"
                >
                  <app-icon
                    name="dollar-sign"
                    size="14"
                    slot="icon"
                    class="mr-1"
                  ></app-icon>
                  Tarifas
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  class="col-span-2 !text-xs !text-red-600 hover:!bg-red-50"
                  [loading]="deletingIds().has(zone.id)"
                  [disabled]="deletingIds().has(zone.id)"
                  (clicked)="deleteZone(zone)"
                >
                  <app-icon
                    name="trash"
                    size="14"
                    slot="icon"
                    class="mr-1"
                  ></app-icon>
                  Eliminar Zona
                </app-button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="py-20 text-center">
          <div
            class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-gray-100"
          >
            <app-icon name="map-pin" size="40" class="text-gray-300"></app-icon>
          </div>
          <h3 class="text-xl font-bold text-[var(--color-text-primary)]">
            Sin zonas de envío del sistema
          </h3>
          <p class="text-[var(--color-text-secondary)] max-w-sm mx-auto mt-2">
            No hay zonas de envío del sistema configuradas. Crea zonas que
            estarán disponibles para todas las tiendas.
          </p>
        </div>
      }

      @defer (when showModal()) {
        <app-superadmin-shipping-zone-modal
          [zone]="selectedZone()"
          (close)="closeModal()"
          (saved)="onSaved()"
        >
        </app-superadmin-shipping-zone-modal>
      }

      @defer (when showRatesModal()) {
        <app-superadmin-shipping-rates
          [zone]="selectedZone()"
          [methods]="methods()"
          (close)="closeRatesModal()"
        >
        </app-superadmin-shipping-rates>
      }
    </div>
  `,
})
export class ShippingZonesComponent implements OnInit {
  private shippingService = inject(ShippingService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  readonly zones = signal<ShippingZone[]>([]);
  readonly methods = signal<ShippingMethod[]>([]);
  readonly loading = signal(false);
  readonly showModal = signal(false);
  readonly showRatesModal = signal(false);
  readonly selectedZone = signal<ShippingZone | undefined>(undefined);
  readonly deletingIds = signal<Set<number>>(new Set());

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    try {
      const [zones, methods] = await Promise.all([
        firstValueFrom(this.shippingService.getZones()),
        firstValueFrom(this.shippingService.getMethods()),
      ]);
      this.zones.set(zones);
      this.methods.set(methods);
    } catch (e) {
      const { userMessage, devMessage } = parseApiError(e);
      console.error('Error loading shipping zones/methods', devMessage, e);
      this.toastService.error(userMessage, 'Error al cargar');
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal() {
    this.selectedZone.set(undefined);
    this.showModal.set(true);
  }

  openEditModal(zone: ShippingZone) {
    this.selectedZone.set(zone);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.selectedZone.set(undefined);
  }

  openRatesModal(zone: ShippingZone) {
    this.selectedZone.set(zone);
    this.showRatesModal.set(true);
  }

  closeRatesModal() {
    this.showRatesModal.set(false);
    this.selectedZone.set(undefined);
  }

  onSaved() {
    this.loadData();
  }

  async deleteZone(zone: ShippingZone) {
    if (this.deletingIds().has(zone.id)) return;

    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Zona de Envío del Sistema',
      message: `¿Estás seguro de que deseas eliminar la zona "${zone.name}"? Esta acción no se puede deshacer y removerá todas sus tarifas asociadas.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.deletingIds.update((s) => new Set(s).add(zone.id));
    try {
      await firstValueFrom(this.shippingService.deleteZone(zone.id));
      this.toastService.success(
        `Zona "${zone.name}" eliminada.`,
        'Eliminado',
      );
      this.zones.update((arr) => arr.filter((z) => z.id !== zone.id));
    } catch (e) {
      const { userMessage, devMessage } = parseApiError(e);
      console.error('Error deleting shipping zone', devMessage, e);
      this.toastService.error(userMessage, 'Error al eliminar');
    } finally {
      this.deletingIds.update((s) => {
        const next = new Set(s);
        next.delete(zone.id);
        return next;
      });
    }
  }
}
