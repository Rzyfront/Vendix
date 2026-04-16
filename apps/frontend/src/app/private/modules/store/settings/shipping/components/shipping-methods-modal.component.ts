import { Component, input, output, signal, computed } from '@angular/core';

import { SystemShippingMethod } from '../interfaces/shipping-methods.interface';
import {
  ModalComponent,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-shipping-methods-modal',
  standalone: true,
  imports: [
    ModalComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [showCloseButton]="true"
      size="md"
      (closed)="close.emit()"
      title="Agregar Método de Envío"
    >
      <div class="flex flex-col gap-4">
        <!-- Subtitle -->
        <p class="text-sm text-text-secondary px-1">
          Activa un método de envío preconfigurado. Las zonas y tarifas se
          copiarán automáticamente.
        </p>

        <!-- Search -->
        <app-inputsearch
          placeholder="Buscar método..."
          (searchChange)="onSearchChange($event)"
        />

        <!-- Loading -->
        @if (is_loading()) {
          <div class="flex justify-center py-8">
            <div
              class="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full"
            ></div>
          </div>
        }

        <!-- Methods List -->
        @if (!is_loading()) {
          <div class="flex flex-col gap-2.5">
            @for (method of filtered_methods(); track method.id) {
              <div
                class="flex items-center gap-3.5 p-3.5 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/[0.02] transition-colors"
              >
                <!-- Icon -->
                <div
                  class="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0"
                  [style.background]="getIconBg(method.type)"
                >
                  <app-icon
                    name="truck"
                    [size]="22"
                    [style.color]="getIconColor(method.type)"
                  />
                </div>
                <!-- Info -->
                <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span class="font-semibold text-sm text-text-primary">{{
                    method.name
                  }}</span>
                  <span class="text-xs text-text-secondary">
                    {{ formatDeliveryTime(method.min_days, method.max_days) }}
                    @if (method.description) {
                      · {{ method.description }}
                    }
                  </span>
                </div>
                <!-- Activate Button -->
                <app-button
                  size="sm"
                  [loading]="is_enabling()"
                  (clicked)="enable.emit(method)"
                  >Activar</app-button
                >
              </div>
            }

            <!-- Empty state -->
            @if (filtered_methods().length === 0) {
              <div class="py-8 text-center">
                <app-icon
                  name="check-circle"
                  [size]="32"
                  class="text-green-500 mx-auto mb-2"
                />
                <p class="text-sm font-medium text-text-primary">
                  ¡Todos los métodos están activos!
                </p>
                <p class="text-xs text-text-secondary mt-1">
                  Ya has activado todos los métodos disponibles
                </p>
              </div>
            }
          </div>
        }
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ShippingMethodsModalComponent {
  readonly available_methods = input<SystemShippingMethod[]>([]);
  readonly is_loading = input<boolean>(false);
  readonly is_enabling = input<boolean>(false);

  readonly enable = output<SystemShippingMethod>();
  readonly close = output<void>();
  readonly refresh = output<void>();

  // Search state as signal
  search_term = signal('');

  // Computed filtered items
  filtered_methods = computed(() => {
    const methods = this.available_methods();
    const term = this.search_term().toLowerCase();
    if (!term) return methods;
    return methods.filter(
      (m) =>
        m.name?.toLowerCase().includes(term) ||
        m.type?.toLowerCase().includes(term) ||
        m.provider_name?.toLowerCase().includes(term),
    );
  });

  // Event handlers
  onSearchChange(term: string): void {
    this.search_term.set(term);
  }

  // Helper methods
  getIconBg(type: string): string {
    const map: Record<string, string> = {
      custom: '#F1F5F9',
      pickup: '#ECFDF5',
      own_fleet: '#DBEAFE',
      carrier: '#FEF3C7',
      third_party_provider: '#F5F3FF',
    };
    return map[type] || '#F1F5F9';
  }

  getIconColor(type: string): string {
    const map: Record<string, string> = {
      custom: '#64748B',
      pickup: '#10B981',
      own_fleet: '#2563EB',
      carrier: '#D97706',
      third_party_provider: '#8B5CF6',
    };
    return map[type] || '#64748B';
  }

  private getTypeLabel(type: string): string {
    const type_map: Record<string, string> = {
      custom: 'Personalizado',
      pickup: 'Recogida',
      own_fleet: 'Flota propia',
      carrier: 'Transportadora',
      third_party_provider: 'Externo',
    };
    return type_map[type] || type;
  }

  formatDeliveryTime(min_days?: number, max_days?: number): string {
    if (min_days == null && max_days == null) return '-';
    if (min_days === max_days) return `${min_days} días`;
    if (!max_days) return `${min_days}+ días`;
    return `${min_days}-${max_days} días`;
  }
}
