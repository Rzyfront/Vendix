import { Component, OnInit, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MetadataFieldsService } from '../services/metadata-fields.service';
import { MetadataField } from '../interfaces/metadata-field.interface';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { FieldModalComponent } from './field-modal/field-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-fields',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, FieldModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-4 sm:p-6">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-lg font-bold" style="color: var(--color-text)">Campos Personalizados</h1>
          <p class="text-sm" style="color: var(--color-text-muted)">Define los campos de datos para clientes, reservas y ordenes</p>
        </div>
        <button class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style="background: var(--color-primary)"
                (click)="openCreateModal()">
          <app-icon name="plus" [size]="16"></app-icon>
          Nuevo Campo
        </button>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-2 mb-4">
        @for (type of entityTypes; track type.value) {
          <button class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                  [style.background]="selectedEntityType() === type.value ? 'var(--color-primary)' : 'var(--color-surface-secondary)'"
                  [style.color]="selectedEntityType() === type.value ? 'white' : 'var(--color-text)'"
                  (click)="filterByType(type.value)">
            {{ type.label }}
          </button>
        }
      </div>

      <!-- Fields Table -->
      <div class="border rounded-lg overflow-hidden" style="border-color: var(--color-border)">
        @if (loading()) {
          <div class="flex items-center justify-center py-12">
            <div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        } @else if (filteredFields().length === 0) {
          <div class="text-center py-12">
            <app-icon name="database" [size]="32" color="var(--color-text-muted)"></app-icon>
            <p class="text-sm mt-2" style="color: var(--color-text-muted)">No hay campos definidos</p>
          </div>
        } @else {
          <!-- Mobile cards -->
          <div class="sm:hidden divide-y" style="border-color: var(--color-border)">
            @for (field of filteredFields(); track field.id) {
              <div class="p-4 flex items-center justify-between" style="background: var(--color-surface)">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium truncate" style="color: var(--color-text)">{{ field.label }}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded" style="background: var(--color-surface-secondary); color: var(--color-text-muted)">
                      {{ field.field_type }}
                    </span>
                  </div>
                  <div class="text-xs mt-0.5" style="color: var(--color-text-muted)">
                    {{ field.field_key }} · {{ field.entity_type }}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button class="p-1.5 rounded-lg transition-colors" style="color: var(--color-text-muted)"
                          (click)="openEditModal(field)">
                    <app-icon name="pencil" [size]="14"></app-icon>
                  </button>
                  <button class="p-1.5 rounded-lg transition-colors"
                          [style.color]="field.is_active ? '#22c55e' : '#ef4444'"
                          (click)="toggleField(field)">
                    <app-icon [name]="field.is_active ? 'eye' : 'eye-off'" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            }
          </div>

          <!-- Desktop table -->
          <table class="hidden sm:table w-full text-sm">
            <thead>
              <tr style="background: var(--color-surface-secondary)">
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Label</th>
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Key</th>
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Tipo</th>
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Entidad</th>
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Display</th>
                <th class="text-left px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Estado</th>
                <th class="text-right px-4 py-3 font-medium text-xs" style="color: var(--color-text-muted)">Acciones</th>
              </tr>
            </thead>
            <tbody class="divide-y" style="border-color: var(--color-border)">
              @for (field of filteredFields(); track field.id) {
                <tr style="background: var(--color-surface)">
                  <td class="px-4 py-3 font-medium" style="color: var(--color-text)">{{ field.label }}</td>
                  <td class="px-4 py-3" style="color: var(--color-text-muted)">{{ field.field_key }}</td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded" style="background: var(--color-surface-secondary); color: var(--color-text-muted)">
                      {{ field.field_type }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="text-xs px-2 py-0.5 rounded-full"
                          [style.background]="field.entity_type === 'customer' ? '#dbeafe' : field.entity_type === 'booking' ? '#dcfce7' : '#fef3c7'"
                          [style.color]="field.entity_type === 'customer' ? '#1e40af' : field.entity_type === 'booking' ? '#166534' : '#92400e'">
                      {{ field.entity_type }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-xs" style="color: var(--color-text-muted)">{{ field.display_mode }}</td>
                  <td class="px-4 py-3">
                    <span class="w-2 h-2 rounded-full inline-block" [style.background]="field.is_active ? '#22c55e' : '#ef4444'"></span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button class="p-1.5 rounded-lg transition-colors" style="color: var(--color-text-muted)"
                            (click)="openEditModal(field)">
                      <app-icon name="pencil" [size]="14"></app-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>

    <!-- Field Modal -->
    @if (isModalOpen()) {
      <app-field-modal
        [field]="selectedField()"
        (save)="onSaveField($event)"
        (close)="closeModal()"
      />
    }
  `,
})
export class FieldsComponent implements OnInit {
  private fieldsService = inject(MetadataFieldsService);
  private toastService = inject(ToastService);

  fields = signal<MetadataField[]>([]);
  loading = signal(true);
  selectedEntityType = signal<string>('');
  isModalOpen = signal(false);
  selectedField = signal<MetadataField | null>(null);

  entityTypes = [
    { value: '', label: 'Todos' },
    { value: 'customer', label: 'Cliente' },
    { value: 'booking', label: 'Reserva' },
    { value: 'order', label: 'Orden' },
  ];

  filteredFields = computed(() => {
    const type = this.selectedEntityType();
    if (!type) return this.fields();
    return this.fields().filter(f => f.entity_type === type);
  });

  ngOnInit() {
    this.loadFields();
  }

  loadFields() {
    this.loading.set(true);
    this.fieldsService.getFields().subscribe({
      next: (fields) => {
        this.fields.set(fields);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  filterByType(type: string) {
    this.selectedEntityType.set(type);
  }

  openCreateModal() {
    this.selectedField.set(null);
    this.isModalOpen.set(true);
  }

  openEditModal(field: MetadataField) {
    this.selectedField.set(field);
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.selectedField.set(null);
  }

  onSaveField(data: any) {
    const selected = this.selectedField();
    const obs = selected
      ? this.fieldsService.updateField(selected.id, data)
      : this.fieldsService.createField(data);

    obs.subscribe({
      next: () => {
        this.toastService.success(selected ? 'Campo actualizado' : 'Campo creado');
        this.closeModal();
        this.loadFields();
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  toggleField(field: MetadataField) {
    this.fieldsService.toggleField(field.id, !field.is_active).subscribe({
      next: () => {
        this.toastService.success(field.is_active ? 'Campo desactivado' : 'Campo activado');
        this.loadFields();
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }
}
