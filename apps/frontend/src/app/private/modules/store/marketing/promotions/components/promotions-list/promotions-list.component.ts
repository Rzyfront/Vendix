import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Promotion } from '../../interfaces/promotion.interface';

@Component({
  selector: 'app-promotions-list',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <div class="bg-white rounded-lg border border-gray-200 shadow-sm">
      <!-- Header -->
      <div class="p-4 border-b border-gray-200">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 class="text-lg font-semibold text-gray-900">Promociones</h2>
          <button
            (click)="create.emit()"
            class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            + Nueva Promocion
          </button>
        </div>

        <!-- Filters -->
        <div class="flex flex-col sm:flex-row gap-3 mt-3">
          <div class="flex-1">
            <input
              type="text"
              [ngModel]="searchValue()"
              (ngModelChange)="onSearchInput($event)"
              placeholder="Buscar por nombre o codigo..."
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
          </div>
          <select
            [ngModel]="stateFilterValue()"
            (ngModelChange)="stateFilterChange.emit($event)"
            class="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          >
            <option value="">Todos los estados</option>
            <option value="draft">Borrador</option>
            <option value="scheduled">Programada</option>
            <option value="active">Activa</option>
            <option value="paused">Pausada</option>
            <option value="expired">Expirada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </div>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin"></div>
          <p class="mt-2 text-sm text-gray-500">Cargando promociones...</p>
        </div>
      }

      <!-- Empty State -->
      @if (!loading() && (!promotions() || promotions()!.length === 0)) {
        <div class="p-8 text-center">
          <div class="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-full mb-3">
            <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
          </div>
          <p class="text-sm text-gray-500">No se encontraron promociones</p>
        </div>
      }

      <!-- Mobile Cards -->
      @if (!loading() && promotions() && promotions()!.length > 0) {
        <div class="block lg:hidden divide-y divide-gray-200">
          @for (promo of promotions(); track promo.id) {
            <div class="p-4">
              <div class="flex items-start justify-between mb-2">
                <div>
                  <h3 class="text-sm font-medium text-gray-900">{{ promo.name }}</h3>
                  @if (promo.code) {
                    <span class="text-xs text-gray-500 font-mono">{{ promo.code }}</span>
                  }
                </div>
                <span [class]="getStateBadgeClass(promo.state)">
                  {{ getStateLabel(promo.state) }}
                </span>
              </div>

              <div class="flex flex-wrap gap-2 mb-2">
                <span [class]="getTypeBadgeClass(promo.type)">
                  {{ getTypeLabel(promo) }}
                </span>
                <span [class]="getScopeBadgeClass(promo.scope)">
                  {{ getScopeLabel(promo.scope) }}
                </span>
              </div>

              <div class="text-xs text-gray-500 mb-3">
                <span>{{ promo.start_date | date:'dd/MM/yyyy' }}</span>
                @if (promo.end_date) {
                  <span> - {{ promo.end_date | date:'dd/MM/yyyy' }}</span>
                }
                <span class="ml-2">|</span>
                <span class="ml-2">{{ promo.usage_count }}{{ promo.usage_limit ? '/' + promo.usage_limit : '' }} usos</span>
              </div>

              <div class="flex gap-2">
                <button
                  (click)="edit.emit(promo)"
                  class="flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Editar
                </button>
                @if (promo.state === 'draft' || promo.state === 'scheduled' || promo.state === 'paused') {
                  <button
                    (click)="activate.emit(promo.id)"
                    class="flex-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200 transition-colors"
                  >
                    Activar
                  </button>
                }
                @if (promo.state === 'active') {
                  <button
                    (click)="pause.emit(promo.id)"
                    class="flex-1 px-3 py-1.5 text-xs font-medium text-yellow-700 bg-yellow-100 rounded-lg hover:bg-yellow-200 transition-colors"
                  >
                    Pausar
                  </button>
                }
                @if (promo.state !== 'cancelled' && promo.state !== 'expired') {
                  <button
                    (click)="cancel.emit(promo.id)"
                    class="flex-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors"
                  >
                    Cancelar
                  </button>
                }
                @if (promo.state === 'draft') {
                  <button
                    (click)="delete.emit(promo.id)"
                    class="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-100 rounded-lg hover:bg-red-200 transition-colors"
                  >
                    Eliminar
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <!-- Desktop Table -->
        <div class="hidden lg:block overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200">
                <th class="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Valor</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Alcance</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Fechas</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Usos</th>
                <th class="text-right px-4 py-3 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              @for (promo of promotions(); track promo.id) {
                <tr class="hover:bg-gray-50 transition-colors">
                  <td class="px-4 py-3">
                    <div>
                      <p class="font-medium text-gray-900">{{ promo.name }}</p>
                      @if (promo.code) {
                        <p class="text-xs text-gray-500 font-mono">{{ promo.code }}</p>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="getTypeBadgeClass(promo.type)">
                      {{ promo.type === 'percentage' ? 'Porcentaje' : 'Monto fijo' }}
                    </span>
                  </td>
                  <td class="px-4 py-3 font-medium text-gray-900">
                    {{ getTypeLabel(promo) }}
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="getScopeBadgeClass(promo.scope)">
                      {{ getScopeLabel(promo.scope) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-gray-600">
                    <div class="text-xs">
                      <p>{{ promo.start_date | date:'dd/MM/yyyy' }}</p>
                      @if (promo.end_date) {
                        <p class="text-gray-400">{{ promo.end_date | date:'dd/MM/yyyy' }}</p>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span [class]="getStateBadgeClass(promo.state)">
                      {{ getStateLabel(promo.state) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-gray-600">
                    {{ promo.usage_count }}{{ promo.usage_limit ? '/' + promo.usage_limit : '' }}
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <button
                        (click)="edit.emit(promo)"
                        class="px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                        title="Editar"
                      >
                        Editar
                      </button>
                      @if (promo.state === 'draft' || promo.state === 'scheduled' || promo.state === 'paused') {
                        <button
                          (click)="activate.emit(promo.id)"
                          class="px-2 py-1 text-xs font-medium text-green-600 hover:text-green-900 hover:bg-green-50 rounded transition-colors"
                          title="Activar"
                        >
                          Activar
                        </button>
                      }
                      @if (promo.state === 'active') {
                        <button
                          (click)="pause.emit(promo.id)"
                          class="px-2 py-1 text-xs font-medium text-yellow-600 hover:text-yellow-900 hover:bg-yellow-50 rounded transition-colors"
                          title="Pausar"
                        >
                          Pausar
                        </button>
                      }
                      @if (promo.state !== 'cancelled' && promo.state !== 'expired') {
                        <button
                          (click)="cancel.emit(promo.id)"
                          class="px-2 py-1 text-xs font-medium text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                          title="Cancelar"
                        >
                          Cancelar
                        </button>
                      }
                      @if (promo.state === 'draft') {
                        <button
                          (click)="delete.emit(promo.id)"
                          class="px-2 py-1 text-xs font-medium text-red-600 hover:text-red-900 hover:bg-red-50 rounded transition-colors"
                          title="Eliminar"
                        >
                          Eliminar
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        @if (meta() && meta()!.total_pages > 1) {
          <div class="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p class="text-xs text-gray-500">
              Mostrando {{ ((meta()!.page - 1) * meta()!.limit) + 1 }} -
              {{ meta()!.page * meta()!.limit > meta()!.total ? meta()!.total : meta()!.page * meta()!.limit }}
              de {{ meta()!.total }}
            </p>
            <div class="flex gap-1">
              <button
                [disabled]="meta()!.page <= 1"
                (click)="pageChange.emit(meta()!.page - 1)"
                class="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Anterior
              </button>
              <button
                [disabled]="meta()!.page >= meta()!.total_pages"
                (click)="pageChange.emit(meta()!.page + 1)"
                class="px-3 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class PromotionsListComponent {
  readonly promotions = input<Promotion[] | null>([]);
  readonly loading = input<boolean | null>(false);
  readonly meta = input<any>(null);
  readonly searchValue = input('');
  readonly stateFilterValue = input('');

  readonly create = output<void>();
  readonly edit = output<Promotion>();
  readonly activate = output<number>();
  readonly pause = output<number>();
  readonly cancel = output<number>();
  readonly delete = output<number>();
  readonly pageChange = output<number>();
  readonly searchChange = output<string>();
  readonly stateFilterChange = output<string>();

  private search_timer: any;

  onSearchInput(value: string): void {
    clearTimeout(this.search_timer);
    this.search_timer = setTimeout(() => {
      this.searchChange.emit(value);
    }, 400);
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      scheduled: 'Programada',
      active: 'Activa',
      paused: 'Pausada',
      expired: 'Expirada',
      cancelled: 'Cancelada',
    };
    return labels[state] || state;
  }

  getStateBadgeClass(state: string): string {
    const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      scheduled: 'bg-blue-100 text-blue-700',
      active: 'bg-green-100 text-green-700',
      paused: 'bg-yellow-100 text-yellow-700',
      expired: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return `${base} ${colors[state] || 'bg-gray-100 text-gray-700'}`;
  }

  getTypeLabel(promo: Promotion): string {
    return promo.type === 'percentage'
      ? `${promo.value}%`
      : `$${promo.value.toLocaleString()}`;
  }

  getTypeBadgeClass(type: string): string {
    const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
    return type === 'percentage'
      ? `${base} bg-purple-100 text-purple-700`
      : `${base} bg-green-100 text-green-700`;
  }

  getScopeLabel(scope: string): string {
    const labels: Record<string, string> = {
      order: 'Orden',
      product: 'Producto',
      category: 'Categoria',
    };
    return labels[scope] || scope;
  }

  getScopeBadgeClass(scope: string): string {
    const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium';
    const colors: Record<string, string> = {
      order: 'bg-blue-100 text-blue-700',
      product: 'bg-green-100 text-green-700',
      category: 'bg-orange-100 text-orange-700',
    };
    return `${base} ${colors[scope] || 'bg-gray-100 text-gray-700'}`;
  }
}
