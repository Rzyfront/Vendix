import { Component, OnInit, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MetadataFieldsService } from '../services/metadata-fields.service';
import { MetadataField } from '../interfaces/metadata-field.interface';
import { FieldModalComponent } from './field-modal/field-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  SpinnerComponent,
  EmptyStateComponent,
  ResponsiveDataViewComponent,
  ScrollableTabsComponent,
  CardComponent,
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import type { TableColumn, TableAction } from '../../../../../shared/components/table/table.component';
import type { ItemListCardConfig } from '../../../../../shared/components/item-list/item-list.interfaces';
import type { ScrollableTab } from '../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

@Component({
  selector: 'app-fields',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FieldModalComponent,
    SpinnerComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    CardComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="md:space-y-4">
      <!-- Entity type filter tabs — outside card -->
      <div class="px-2 md:px-0">
        <app-scrollable-tabs
          [tabs]="entityFilterTabs"
          [activeTab]="selectedEntityType()"
          size="xs"
          (tabChange)="filterByType($event)"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[400px]">
        <!-- Search Section: sticky on mobile, normal on desktop -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <!-- Title with count -->
            <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
              Campos Personalizados
              <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ filteredFields().length }})</span>
            </h2>

            <!-- Search + New button -->
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar campos..."
                [debounceTime]="500"
                [ngModel]="searchTerm()"
                (ngModelChange)="onSearchChange($event)"
              />

              <app-button
                variant="outline"
                size="md"
                customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="openCreateModal()"
                title="Nuevo Campo">
                <app-icon slot="icon" name="plus" [size]="18" />
              </app-button>
            </div>
          </div>
        </div>

        <!-- Loading -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <app-spinner size="md" />
            <p class="mt-2 text-text-secondary text-sm">Cargando campos...</p>
          </div>
        } @else if (filteredFields().length === 0) {
          <app-empty-state
            icon="database"
            title="No hay campos"
            description="Define los campos de datos para clientes, reservas y órdenes"
            [showActionButton]="true"
            actionButtonText="Nuevo Campo"
            actionButtonIcon="plus"
            (actionClick)="openCreateModal()"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="filteredFields()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="false"
              emptyMessage="No hay campos definidos"
              emptyIcon="database"
            />
          </div>
        }
      </app-card>
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
  private dialogService = inject(DialogService);

  fields = signal<MetadataField[]>([]);
  loading = signal(true);
  selectedEntityType = signal<string>('');
  searchTerm = signal('');
  isModalOpen = signal(false);
  selectedField = signal<MetadataField | null>(null);

  entityFilterTabs: ScrollableTab[] = [
    { id: '', label: 'Todos' },
    { id: 'customer', label: 'Cliente' },
    { id: 'booking', label: 'Reserva' },
    { id: 'order', label: 'Orden' },
  ];

  columns: TableColumn[] = [
    { key: 'label', label: 'Label', sortable: true },
    { key: 'field_key', label: 'Key' },
    { key: 'field_type', label: 'Tipo' },
    { key: 'entity_type', label: 'Entidad' },
    { key: 'display_mode', label: 'Display' },
    {
      key: 'is_active',
      label: 'Estado',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          true: '#22c55e',
          false: '#ef4444',
        },
      },
      transform: (value: boolean) => value ? 'Activo' : 'Inactivo',
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'primary',
      action: (field: MetadataField) => this.openEditModal(field),
    },
    {
      label: (field: MetadataField) => (field.is_active ? 'Desactivar' : 'Activar'),
      icon: (field: MetadataField) => (field.is_active ? 'toggle-right' : 'toggle-left'),
      variant: (field: MetadataField) => (field.is_active ? 'warning' : 'success'),
      action: (field: MetadataField) => this.toggleField(field),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (field: MetadataField) => { this.confirmDeleteField(field); },
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'label',
    subtitleKey: 'field_key',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        true: '#22c55e',
        false: '#ef4444',
      },
    },
    badgeTransform: (val: any) => val ? 'Activo' : 'Inactivo',
    detailKeys: [
      { key: 'entity_type', label: 'Entidad' },
      { key: 'field_type', label: 'Tipo' },
      { key: 'display_mode', label: 'Display' },
    ],
  };

  filteredFields = computed(() => {
    let result = this.fields();
    const type = this.selectedEntityType();
    if (type) {
      result = result.filter(f => f.entity_type === type);
    }
    const term = this.searchTerm().toLowerCase().trim();
    if (term) {
      result = result.filter(f =>
        f.label.toLowerCase().includes(term) ||
        f.field_key.toLowerCase().includes(term) ||
        f.field_type.toLowerCase().includes(term)
      );
    }
    return result;
  });

  ngOnInit() {
    this.loadFields();
  }

  loadFields() {
    this.loading.set(true);
    this.fieldsService.getFields(undefined, true).subscribe({
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

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
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

  async confirmDeleteField(field: MetadataField) {
    const value = await this.dialogService.prompt({
      title: 'Eliminar campo',
      message: `Para confirmar la eliminación de "${field.label}", escribe la palabra "eliminar".`,
      placeholder: 'eliminar',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });

    if (value?.trim().toLowerCase() !== 'eliminar') {
      if (value !== undefined) {
        this.toastService.error('Debes escribir "eliminar" para confirmar');
      }
      return;
    }

    this.fieldsService.deleteField(field.id).subscribe({
      next: () => {
        this.toastService.success('Campo eliminado');
        this.loadFields();
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }
}
