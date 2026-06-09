import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from './services/withholding-tax.service';
import { WithholdingConcept, WithholdingStats } from './interfaces/withholding.interface';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import {
  ButtonComponent,
  IconComponent,
  ConfirmationModalComponent,
  ToastService,
} from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { WithholdingConceptFormModalComponent } from './components/withholding-concept-form-modal.component';

@Component({
  selector: 'app-withholding-tax',
  standalone: true,
  imports: [
    StatsComponent,
    ButtonComponent,
    IconComponent,
    ConfirmationModalComponent,
    WithholdingConceptFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="sticky top-0 z-20 bg-white dark:bg-gray-900 pb-2 md:static md:z-auto">
        <div class="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          <app-stats title="Conceptos Activos" [value]="stats()?.active_concepts || 0" icon="file-text" color="blue"></app-stats>
          <app-stats title="UVT Vigente" [value]="formatCurrency(stats()?.current_uvt || 0)" icon="calculator" color="green"></app-stats>
          <app-stats title="Ret. del Mes" [value]="formatCurrency(stats()?.month_withholdings || 0)" icon="trending-down" color="orange"></app-stats>
          <app-stats title="Ret. del Año" [value]="formatCurrency(stats()?.year_withholdings || 0)" icon="calendar" color="purple"></app-stats>
        </div>
      </div>

      <!-- Concepts Table -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow mt-4">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center gap-3">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Conceptos de Retención</h2>
          <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Nuevo Concepto
          </app-button>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead class="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Código</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Tipo</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tasa %</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Umbral UVT</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">Aplica a</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">PUC</th>
                <th class="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Estado</th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700">
              @for (concept of concepts(); track concept.id) {
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td class="px-4 py-3 text-sm font-mono">{{ concept.code }}</td>
                  <td class="px-4 py-3 text-sm">{{ concept.name }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell">{{ withholdingTypeLabel(concept.withholding_type) }}</td>
                  <td class="px-4 py-3 text-sm text-right">{{ (concept.rate * 100).toFixed(1) }}%</td>
                  <td class="px-4 py-3 text-sm text-right hidden md:table-cell">{{ concept.min_uvt_threshold }}</td>
                  <td class="px-4 py-3 text-sm hidden md:table-cell capitalize">{{ concept.applies_to }}</td>
                  <td class="px-4 py-3 text-sm font-mono hidden lg:table-cell">{{ concept.account_code || '—' }}</td>
                  <td class="px-4 py-3 text-sm text-center">
                    <span [class]="concept.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'"
                          class="px-2 py-1 rounded-full text-xs font-medium">
                      {{ concept.is_active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-sm">
                    <div class="flex items-center justify-end gap-1">
                      <app-button variant="ghost" size="sm" (clicked)="openEditModal(concept)" title="Editar">
                        <app-icon name="edit" [size]="16" slot="icon"></app-icon>
                      </app-button>
                      <app-button variant="ghost" size="sm" (clicked)="openDeleteModal(concept)" title="Eliminar">
                        <app-icon name="trash" [size]="16" slot="icon"></app-icon>
                      </app-button>
                    </div>
                  </td>
                </tr>
              }
              @empty {
                <tr>
                  <td colspan="9" class="px-4 py-8 text-center text-gray-500">No hay conceptos de retención configurados</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create / Edit Modal -->
      @if (isFormModalOpen()) {
        <app-withholding-concept-form-modal
          [(isOpen)]="isFormModalOpen"
          [concept]="editingConcept()"
          (saved)="onConceptSaved()"
        ></app-withholding-concept-form-modal>
      }

      <!-- Delete Confirmation -->
      <app-confirmation-modal
        [(isOpen)]="isDeleteModalOpen"
        title="Eliminar Concepto"
        [message]="
          '¿Estás seguro de que deseas eliminar el concepto ' +
          (conceptToDelete()?.name || '') +
          '? Quedará inactivo y dejará de aplicarse.'
        "
        confirmText="Eliminar"
        confirmVariant="danger"
        (confirm)="confirmDelete()"
        (cancel)="closeDeleteModal()"
      ></app-confirmation-modal>
    </div>
  `,
})
export class WithholdingTaxComponent {
  private service = inject(WithholdingTaxService);
  private currencyService = inject(CurrencyFormatService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly concepts = signal<WithholdingConcept[]>([]);
  readonly stats = signal<WithholdingStats | null>(null);

  readonly isFormModalOpen = signal(false);
  readonly editingConcept = signal<WithholdingConcept | null>(null);

  readonly isDeleteModalOpen = signal(false);
  readonly conceptToDelete = signal<WithholdingConcept | null>(null);

  constructor() {
    this.loadData();
  }

  loadData() {
    this.service.getConcepts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.concepts.set(res.data || []);
      });
    this.service.getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.stats.set(res.data || null);
      });
  }

  openCreateModal(): void {
    this.editingConcept.set(null);
    this.isFormModalOpen.set(true);
  }

  openEditModal(concept: WithholdingConcept): void {
    this.editingConcept.set(concept);
    this.isFormModalOpen.set(true);
  }

  onConceptSaved(): void {
    this.loadData();
  }

  openDeleteModal(concept: WithholdingConcept): void {
    this.conceptToDelete.set(concept);
    this.isDeleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    this.isDeleteModalOpen.set(false);
    this.conceptToDelete.set(null);
  }

  confirmDelete(): void {
    const concept = this.conceptToDelete();
    if (!concept) return;
    this.service.deleteConcept(concept.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Concepto eliminado');
          this.closeDeleteModal();
          this.loadData();
        },
        error: (err: any) => {
          const message =
            err?.error?.message ?? 'No se pudo eliminar el concepto';
          this.toast.error(
            Array.isArray(message) ? message.join(', ') : message,
          );
          this.closeDeleteModal();
        },
      });
  }

  withholdingTypeLabel(type?: string): string {
    switch (type) {
      case 'reteiva':
        return 'ReteIVA';
      case 'reteica':
        return 'ReteICA';
      case 'retefuente':
        return 'Retefuente';
      default:
        return 'Retefuente';
    }
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(Number(value) || 0, 0);
  }
}
