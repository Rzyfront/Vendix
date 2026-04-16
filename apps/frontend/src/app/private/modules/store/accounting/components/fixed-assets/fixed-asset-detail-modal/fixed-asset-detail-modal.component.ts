import { Component, input, output, inject, effect } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';

import { AccountingService } from '../../../services/accounting.service';
import {
  FixedAsset,
  DepreciationScheduleEntry,
  DepreciationEntry,
} from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-fixed-asset-detail-modal',
  standalone: true,
  imports: [
    DatePipe,
    CurrencyPipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="asset()?.name || 'Detalle del Activo'"
      size="xl"
    >
      @if (asset()) {
        <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">

          <!-- Asset Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Numero</p>
              <p class="text-sm font-mono font-semibold">{{ asset()?.asset_number }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Categoria</p>
              <p class="text-sm font-medium">{{ asset()?.category?.name || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Estado</p>
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                    [class]="getStatusClass(asset()?.status ?? '')">
                {{ getStatusLabel(asset()?.status ?? '') }}
              </span>
            </div>
            <div>
              <p class="text-xs text-gray-500">Metodo</p>
              <p class="text-sm">{{ asset()?.depreciation_method === 'straight_line' ? 'Linea Recta' : 'Saldo Decreciente' }}</p>
            </div>
          </div>

          <!-- Financial Summary -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
            <div>
              <p class="text-xs text-gray-500">Costo Adquisicion</p>
              <p class="text-sm font-semibold font-mono">{{ asset()?.acquisition_cost | currency:'COP':'symbol-narrow':'1.0-0' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Deprec. Acumulada</p>
              <p class="text-sm font-semibold font-mono text-red-500">{{ asset()?.accumulated_depreciation | currency:'COP':'symbol-narrow':'1.0-0' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Valor en Libros</p>
              <p class="text-sm font-bold font-mono text-primary">{{ (asset()?.book_value ?? 0) | currency:'COP':'symbol-narrow':'1.0-0' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Valor Residual</p>
              <p class="text-sm font-semibold font-mono">{{ asset()?.salvage_value | currency:'COP':'symbol-narrow':'1.0-0' }}</p>
            </div>
          </div>

          <!-- Dates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Fecha Adquisicion</p>
              <p class="text-sm">{{ asset()?.acquisition_date | date:'dd/MM/yyyy' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Inicio Depreciacion</p>
              <p class="text-sm">{{ asset()?.depreciation_start_date ? (asset()?.depreciation_start_date | date:'dd/MM/yyyy') : '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Vida Util</p>
              <p class="text-sm">{{ asset()?.useful_life_months }} meses</p>
            </div>
            @if (asset()?.description) {
              <div>
                <p class="text-xs text-gray-500">Descripcion</p>
                <p class="text-sm">{{ asset()?.description }}</p>
              </div>
            }
          </div>

          @if (asset()?.notes) {
            <div>
              <p class="text-xs text-gray-500">Notas</p>
              <p class="text-sm text-gray-700">{{ asset()?.notes }}</p>
            </div>
          }

          <!-- Tabs: Schedule / History -->
          <div class="border-b border-border">
            <div class="flex gap-4">
              <button
                class="py-2 px-1 text-sm font-medium border-b-2 transition-colors"
                [class]="active_tab === 'schedule' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'"
                (click)="active_tab = 'schedule'"
              >
                Depreciacion Proyectada
              </button>
              <button
                class="py-2 px-1 text-sm font-medium border-b-2 transition-colors"
                [class]="active_tab === 'history' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'"
                (click)="active_tab = 'history'"
              >
                Historial Ejecutado
              </button>
            </div>
          </div>

          <!-- Schedule Table -->
          @if (active_tab === 'schedule') {
            @if (is_loading_schedule) {
              <div class="flex justify-center py-8">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            } @else if (schedule.length === 0) {
              <p class="text-sm text-gray-400 text-center py-6">No hay cronograma disponible.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-xs text-gray-500 uppercase bg-gray-50">
                      <th class="px-3 py-2 text-left">Mes</th>
                      <th class="px-3 py-2 text-left">Periodo</th>
                      <th class="px-3 py-2 text-right">Depreciacion</th>
                      <th class="px-3 py-2 text-right">Acumulada</th>
                      <th class="px-3 py-2 text-right">Valor Libros</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    @for (entry of schedule; track entry.month) {
                      <tr class="hover:bg-gray-50">
                        <td class="px-3 py-2">{{ entry.month }}</td>
                        <td class="px-3 py-2">{{ entry.period_date | date:'MM/yyyy' }}</td>
                        <td class="px-3 py-2 text-right font-mono">{{ entry.depreciation_amount | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                        <td class="px-3 py-2 text-right font-mono text-red-500">{{ entry.accumulated_total | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                        <td class="px-3 py-2 text-right font-mono font-semibold">{{ entry.book_value | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }

          <!-- History Table -->
          @if (active_tab === 'history') {
            @if (is_loading_history) {
              <div class="flex justify-center py-8">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            } @else if (history.length === 0) {
              <p class="text-sm text-gray-400 text-center py-6">No se han ejecutado depreciaciones aun.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-xs text-gray-500 uppercase bg-gray-50">
                      <th class="px-3 py-2 text-left">Periodo</th>
                      <th class="px-3 py-2 text-right">Monto</th>
                      <th class="px-3 py-2 text-right">Acumulada</th>
                      <th class="px-3 py-2 text-right">Valor Libros</th>
                      <th class="px-3 py-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    @for (entry of history; track entry.id) {
                      <tr class="hover:bg-gray-50">
                        <td class="px-3 py-2">{{ entry.period_date | date:'MM/yyyy' }}</td>
                        <td class="px-3 py-2 text-right font-mono">{{ entry.depreciation_amount | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                        <td class="px-3 py-2 text-right font-mono text-red-500">{{ entry.accumulated_total | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                        <td class="px-3 py-2 text-right font-mono font-semibold">{{ entry.book_value | currency:'COP':'symbol-narrow':'1.0-0' }}</td>
                        <td class="px-3 py-2 text-center">
                          <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                                [class]="entry.status === 'posted' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'">
                            {{ entry.status === 'posted' ? 'Contabilizado' : 'Pendiente' }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }

          <!-- Actions (only for active assets) -->
          @if (asset()?.status === 'active') {
            <div class="border-t border-border pt-4">
              <h4 class="text-sm font-semibold text-gray-700 mb-3">Acciones</h4>

              @if (!show_dispose_form) {
                <div class="flex gap-3">
                  <app-button variant="outline" size="sm" (clicked)="onRetire()">
                    <app-icon name="power" [size]="14" slot="icon"></app-icon>
                    Retirar Activo
                  </app-button>
                  <app-button variant="outline" size="sm" (clicked)="show_dispose_form = true">
                    <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                    Dar de Baja
                  </app-button>
                </div>
              } @else {
                <!-- Dispose Form -->
                <form [formGroup]="dispose_form" class="p-4 bg-red-50 rounded-lg space-y-3">
                  <p class="text-sm font-medium text-red-700">Dar de baja el activo</p>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <app-input
                      label="Fecha de Baja"
                      formControlName="disposal_date"
                      [control]="dispose_form.get('disposal_date')"
                      [required]="true"
                      type="date"
                    ></app-input>
                    <app-input
                      label="Monto de Venta/Recuperacion"
                      formControlName="disposal_amount"
                      [control]="dispose_form.get('disposal_amount')"
                      [required]="true"
                      type="number"
                      placeholder="0"
                    ></app-input>
                  </div>
                  <div class="flex gap-2 justify-end">
                    <app-button variant="outline" size="sm" (clicked)="show_dispose_form = false">Cancelar</app-button>
                    <app-button variant="primary" size="sm" (clicked)="onDispose()"
                                [disabled]="dispose_form.invalid || is_disposing"
                                [loading]="is_disposing">
                      Confirmar Baja
                    </app-button>
                  </div>
                </form>
              }
            </div>
          }
        </div>
      }

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">Cerrar</app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class FixedAssetDetailModalComponent {
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly asset = input<FixedAsset | null>(null);
  readonly assetUpdated = output<void>();

  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);
  private fb = inject(FormBuilder);

  active_tab: 'schedule' | 'history' = 'schedule';
  schedule: DepreciationScheduleEntry[] = [];
  history: DepreciationEntry[] = [];
  is_loading_schedule = false;
  is_loading_history = false;

  // Dispose
  show_dispose_form = false;
  is_disposing = false;
  dispose_form = this.fb.group({
    disposal_date: ['', [Validators.required]],
    disposal_amount: [0, [Validators.required, Validators.min(0)]],
  });

  constructor() {
    effect(() => {
      if (this.isOpen() && this.asset()) {
        this.active_tab = 'schedule';
        this.show_dispose_form = false;
        this.loadSchedule();
        this.loadHistory();
      }
    });
  }

  private loadSchedule(): void {
    if (!this.asset()) return;
    this.is_loading_schedule = true;
    this.accounting_service.getDepreciationSchedule(this.asset()!.id).subscribe({
      next: (res) => {
        this.schedule = res.data;
        this.is_loading_schedule = false;
      },
      error: () => {
        this.is_loading_schedule = false;
      },
    });
  }

  private loadHistory(): void {
    if (!this.asset()) return;
    this.is_loading_history = true;
    this.accounting_service.getDepreciationHistory(this.asset()!.id).subscribe({
      next: (res) => {
        this.history = res.data;
        this.is_loading_history = false;
      },
      error: () => {
        this.is_loading_history = false;
      },
    });
  }

  onRetire(): void {
    if (!this.asset()) return;
    if (!confirm('¿Estas seguro de retirar este activo? Esta accion no se puede deshacer.')) return;

    this.accounting_service.retireAsset(this.asset()!.id).subscribe({
      next: () => {
        this.toast_service.show({ variant: 'success', description: 'Activo retirado correctamente' });
        this.assetUpdated.emit();
        this.onClose();
      },
      error: () => {
        this.toast_service.show({ variant: 'error', description: 'Error al retirar el activo' });
      },
    });
  }

  onDispose(): void {
    if (!this.asset() || this.dispose_form.invalid) return;
    this.is_disposing = true;

    const values = this.dispose_form.getRawValue();
    this.accounting_service
      .disposeAsset(this.asset()!.id, {
        disposal_date: values.disposal_date!,
        disposal_amount: Number(values.disposal_amount),
      })
      .subscribe({
        next: () => {
          this.toast_service.show({ variant: 'success', description: 'Activo dado de baja correctamente' });
          this.is_disposing = false;
          this.assetUpdated.emit();
          this.onClose();
        },
        error: () => {
          this.toast_service.show({ variant: 'error', description: 'Error al dar de baja el activo' });
          this.is_disposing = false;
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.show_dispose_form = false;
    this.schedule = [];
    this.history = [];
    this.dispose_form.reset({ disposal_date: '', disposal_amount: 0 });
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      fully_depreciated: 'Depreciado',
      retired: 'Retirado',
      disposed: 'Baja',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-600',
      fully_depreciated: 'bg-amber-50 text-amber-600',
      retired: 'bg-gray-100 text-gray-500',
      disposed: 'bg-red-50 text-red-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }
}
