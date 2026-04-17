import { Component, inject, input, output, signal } from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { InvoiceResolution } from '../../interfaces/invoice.interface';
import {
  selectResolutions,
  selectResolutionsLoading,
} from '../../state/selectors/invoicing.selectors';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ResolutionCreateComponent } from './resolution-create/resolution-create.component';

@Component({
  selector: 'vendix-resolutions',
  standalone: true,
  imports: [
    NgClass,
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    ResolutionCreateComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Resoluciones de Facturación"
      size="lg"
    >
      <div class="p-4">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <p class="text-sm text-text-secondary">
            Configure las resoluciones DIAN para numeración de facturas
          </p>
          <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
            <app-icon slot="icon" name="plus" [size]="14"></app-icon>
            Nueva
          </app-button>
        </div>

        <!-- Loading -->
        @if (loading()) {
          <div class="py-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
            ></div>
          </div>
        }

        <!-- Resolutions List -->
        @if (!loading()) {
          <div class="space-y-3">
            @for (resolution of resolutions(); track resolution) {
              <div
                class="border border-border rounded-lg p-3 flex items-start justify-between gap-3"
                [class.opacity-50]="!resolution.is_active"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-medium text-text-primary">
                      {{ resolution.prefix }} -
                      {{ resolution.resolution_number }}
                    </span>
                    <span
                      class="px-1.5 py-0.5 text-xs rounded-full"
                      [ngClass]="
                        resolution.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      "
                    >
                      {{ resolution.is_active ? 'Activa' : 'Inactiva' }}
                    </span>
                  </div>
                  <div class="text-xs text-text-secondary space-y-0.5">
                    <div>
                      Rango: {{ resolution.range_from }} -
                      {{ resolution.range_to }} | Actual:
                      {{ resolution.current_number }}
                    </div>
                    <div>
                      Vigencia:
                      {{ resolution.valid_from | date: 'dd/MM/yyyy' }} -
                      {{ resolution.valid_to | date: 'dd/MM/yyyy' }}
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    (click)="editResolution(resolution)"
                    class="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-text-secondary hover:text-primary"
                    title="Editar"
                  >
                    <app-icon name="edit" [size]="14"></app-icon>
                  </button>
                  <button
                    (click)="onDeleteResolution(resolution.id)"
                    class="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-text-secondary hover:text-red-500"
                    title="Eliminar"
                  >
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            }
            <!-- Empty State -->
            @if (resolutions()?.length === 0) {
              <div class="py-8 text-center">
                <app-icon
                  name="file-text"
                  [size]="32"
                  class="text-gray-400 mx-auto mb-2"
                ></app-icon>
                <p class="text-text-secondary text-sm">
                  No hay resoluciones configuradas
                </p>
                <app-button
                  variant="primary"
                  size="sm"
                  class="mt-3"
                  (clicked)="openCreateModal()"
                >
                  Crear primera resolución
                </app-button>
              </div>
            }
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>

    <!-- Create/Edit Resolution Modal -->
    <vendix-resolution-create
      [isOpen]="isCreateModalOpen()"
      (isOpenChange)="isCreateModalOpen.set($event)"
      [resolution]="selectedResolution()"
    ></vendix-resolution-create>
  `,
})
export class ResolutionsComponent {
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();

  private store = inject(Store);

  resolutions$: Observable<InvoiceResolution[]> =
    this.store.select(selectResolutions);
  loading$: Observable<boolean> = this.store.select(selectResolutionsLoading);

  readonly isCreateModalOpen = signal(false);
  readonly selectedResolution = signal<InvoiceResolution | null>(null);

  constructor() {
    this.store.dispatch(InvoicingActions.loadResolutions());
  }

  openCreateModal(): void {
    this.selectedResolution.set(null);
    this.isCreateModalOpen.set(true);
  }

  editResolution(resolution: InvoiceResolution): void {
    this.selectedResolution.set(resolution);
    this.isCreateModalOpen.set(true);
  }

  onDeleteResolution(id: number): void {
    this.store.dispatch(InvoicingActions.deleteResolution({ id }));
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
