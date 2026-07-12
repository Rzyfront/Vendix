import { Component, DestroyRef, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { WithholdingTaxService } from '../services/withholding-tax.service';
import { WithholdingConcept } from '../interfaces/withholding.interface';
import {
  ButtonComponent,
  IconComponent,
  ConfirmationModalComponent,
  ToastService,
} from '../../../../../shared/components';
import { WithholdingConceptFormModalComponent } from './withholding-concept-form-modal.component';

/**
 * "Conceptos" tab — CRUD of withholding concepts. Extracted as-is from the
 * former single-view WithholdingTaxComponent so the container can host the
 * Cálculos and Certificados tabs alongside it. Emits `changed` after any
 * mutation so the container refreshes the stats cards.
 */
@Component({
  selector: 'app-withholding-concepts-tab',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ConfirmationModalComponent,
    WithholdingConceptFormModalComponent,
  ],
  template: `
    <!-- Concepts Table -->
    <div class="bg-[var(--color-surface)] rounded-lg shadow">
      <div class="p-4 border-b border-border flex justify-between items-center gap-3">
        <h2 class="text-lg font-semibold text-text-primary">Conceptos de Retención</h2>
        <app-button variant="primary" size="sm" (clicked)="openCreateModal()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Nuevo Concepto
        </app-button>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-[var(--color-border)]">
          <thead class="bg-[var(--color-surface-secondary)]">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Código</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Nombre</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase hidden md:table-cell">Tipo</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Tasa %</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase hidden md:table-cell">Umbral UVT</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase hidden md:table-cell">Aplica a</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase hidden lg:table-cell">PUC</th>
              <th class="px-4 py-3 text-center text-xs font-medium text-text-secondary uppercase">Estado</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--color-border)]">
            @for (concept of concepts(); track concept.id) {
              <tr class="hover:bg-[var(--color-surface-secondary)]">
                <td class="px-4 py-3 text-sm font-mono">{{ concept.code }}</td>
                <td class="px-4 py-3 text-sm">{{ concept.name }}</td>
                <td class="px-4 py-3 text-sm hidden md:table-cell">{{ withholdingTypeLabel(concept.withholding_type) }}</td>
                <td class="px-4 py-3 text-sm text-right">{{ (concept.rate * 100).toFixed(1) }}%</td>
                <td class="px-4 py-3 text-sm text-right hidden md:table-cell">{{ concept.min_uvt_threshold }}</td>
                <td class="px-4 py-3 text-sm hidden md:table-cell capitalize">{{ concept.applies_to }}</td>
                <td class="px-4 py-3 text-sm font-mono hidden lg:table-cell">{{ concept.account_code || '—' }}</td>
                <td class="px-4 py-3 text-sm text-center">
                  <span [class]="concept.is_active ? 'bg-success-light text-success' : 'bg-[var(--color-surface-secondary)] text-text-secondary'"
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
                <td colspan="9" class="px-4 py-8 text-center text-text-secondary">No hay conceptos de retención configurados</td>
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
  `,
})
export class WithholdingConceptsTabComponent {
  private service = inject(WithholdingTaxService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  /** Emitted after create/update/delete so the container refreshes stats. */
  readonly changed = output<void>();

  readonly concepts = signal<WithholdingConcept[]>([]);

  readonly isFormModalOpen = signal(false);
  readonly editingConcept = signal<WithholdingConcept | null>(null);

  readonly isDeleteModalOpen = signal(false);
  readonly conceptToDelete = signal<WithholdingConcept | null>(null);

  constructor() {
    this.loadConcepts();
  }

  loadConcepts(): void {
    this.service.getConcepts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res: any) => {
        this.concepts.set(res.data || []);
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
    this.loadConcepts();
    this.changed.emit();
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
          this.loadConcepts();
          this.changed.emit();
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
}
