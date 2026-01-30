import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LegalDocumentsService } from './services/legal-documents.service';
import {
  LegalDocument,
  LegalDocumentTypeEnum,
  CreateSystemDocumentDto,
  UpdateSystemDocumentDto,
} from './interfaces/legal-document.interface';
import { LegalDocumentModalComponent } from './components/legal-document-modal/legal-document-modal.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../shared/components/selector/selector.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../shared/components/inputsearch/inputsearch.component';
import {
  TableComponent,
  TableColumn,
  TableAction,
} from '../../../../shared/components/table/table.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-legal-documents',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    LegalDocumentModalComponent,
    ButtonComponent,
    SelectorComponent,
    StatsComponent,
    InputsearchComponent,
    TableComponent,
    IconComponent,
  ],
  template: `
    <!-- Standard Module Layout -->
    <div class="flex flex-col gap-6 p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <app-stats
          title="Total Documentos"
          [value]="totalDocuments()"
          iconName="file-text"
          iconBgColor="bg-gray-100"
          iconColor="text-gray-600"
        ></app-stats>

        <app-stats
          title="Activos"
          [value]="activeDocumentsCount()"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Tipos Configurados"
          [value]="documentTypesCount()"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Última Actualización"
          [value]="lastUpdateFormatted()"
          iconName="clock"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Main Content Card -->
      <div
        class="flex flex-col bg-surface border border-border rounded-xl shadow-sm overflow-hidden"
      >
        <!-- Header (Compact & Symmetric) -->
        <div
          class="p-4 md:px-6 md:py-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-surface"
        >
          <!-- Left Side -->
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold text-text-primary">
              Documentos Legales
            </h3>
            <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
              Gestiona los términos, condiciones y políticas del sistema.
            </p>
          </div>

          <!-- Right Side (Controls) -->
          <div
            class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
          >
            <!-- Search -->
            <div class="w-full sm:w-60">
              <app-inputsearch
                placeholder="Buscar..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
                size="sm"
                fullWidth="true"
              ></app-inputsearch>
            </div>

            <!-- Selector -->
            <div class="w-full sm:w-48">
              <app-selector
                placeholder="Filtrar por tipo"
                [options]="typeFilterOptions"
                [formControl]="typeFilterControl"
                size="sm"
                variant="outline"
              ></app-selector>
            </div>

            <!-- Actions -->
            <div class="flex gap-2 items-center sm:ml-auto">
              <app-button
                variant="primary"
                size="sm"
                iconName="plus"
                (clicked)="openCreateModal()"
              >
                <span class="hidden sm:inline">Nuevo</span>
                <span class="sm:hidden">Plus</span>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Table Container -->
        <div class="relative min-h-[400px] p-2 md:p-4">
          <!-- Loading Overlay -->
          <div
            *ngIf="loading()"
            class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center"
          >
            <div
              class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
          </div>

          <app-table
            [data]="filteredDocuments()"
            [columns]="columns"
            [actions]="actions"
            [loading]="loading()"
            [showHeader]="true"
            [hoverable]="true"
            emptyMessage="No se encontraron documentos"
          >
            <!-- Custom Empty State inside table if needed, though app-table handles emptyMessage -->
            <div
              class="p-12 flex flex-col items-center justify-center text-center"
              *ngIf="!loading() && filteredDocuments().length === 0"
            >
              <div
                class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4"
              >
                <app-icon
                  name="file-text"
                  size="32"
                  class="text-gray-400"
                ></app-icon>
              </div>
              <h3 class="text-lg font-medium text-gray-900 mb-1">
                No hay documentos
              </h3>
              <p class="text-gray-500 max-w-sm mb-6">
                No se encontraron documentos que coincidan con tus filtros o
                búsqueda.
              </p>
              <app-button
                variant="primary"
                size="sm"
                iconName="plus"
                (clicked)="openCreateModal()"
              >
                Crear Documento
              </app-button>
            </div>
          </app-table>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <app-legal-document-modal
      [(isOpen)]="isModalOpen"
      [document]="selectedDocument"
      (save)="onSaveDocument($event)"
      (cancel)="closeModal()"
    ></app-legal-document-modal>
  `,
})
export class LegalDocumentsComponent implements OnInit {
  private service = inject(LegalDocumentsService);
  private toast = inject(ToastService);

  // Signals
  documents = signal<LegalDocument[]>([]);
  loading = signal<boolean>(false);
  searchQuery = signal<string>('');

  // Controls
  typeFilterControl = new FormControl<string | null>(null);

  // Computed Stats
  totalDocuments = computed(() => this.documents().length);
  activeDocumentsCount = computed(
    () => this.documents().filter((d) => d.is_active).length,
  );
  documentTypesCount = computed(
    () => new Set(this.documents().map((d) => d.document_type)).size,
  );
  lastUpdateFormatted = computed(() => {
    const docs = this.documents();
    if (docs.length === 0) return 'N/A';
    const dates = docs.map((d) =>
      new Date(d.updated_at || d.created_at).getTime(),
    );
    const maxDate = new Date(Math.max(...dates));
    return maxDate.toLocaleDateString();
  });

  // Computed Filtered Data
  filteredDocuments = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const typeFilter = this.typeFilterControl.value;

    return this.documents().filter((doc) => {
      const matchesSearch =
        doc.title.toLowerCase().includes(query) ||
        doc.version.toLowerCase().includes(query) ||
        this.formatEnumLabel(doc.document_type).toLowerCase().includes(query);

      const matchesType = typeFilter ? doc.document_type === typeFilter : true;

      return matchesSearch && matchesType;
    });
  });

  // Modal State
  isModalOpen = false;
  selectedDocument?: LegalDocument;

  // Options
  typeFilterOptions: SelectorOption[] = [];

  // Table Config
  columns: TableColumn[] = [
    {
      key: 'title',
      label: 'Título',
      width: '30%',
    },
    {
      key: 'document_type',
      label: 'Tipo',
      width: '20%',
      transform: (val) => this.formatEnumLabel(val),
    },
    {
      key: 'version',
      label: 'Versión',
      width: '10%',
      template: undefined, // Will handle badge via badgeConfig if table supported it better, but default text is fine or custom template if needed.
      // Let's stick to simple text for now as badgeConfig in TableComponent is for status mostly.
      // Actually TableComponent has badge support.
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          default: 'bg-gray-100 text-gray-800',
        },
      },
    },
    {
      key: 'is_active',
      label: 'Estado',
      width: '15%',
      badge: true,
      transform: (val) => (val ? 'Activo' : 'Inactivo'),
      badgeConfig: {
        type: 'status',
      },
    },
    {
      key: 'effective_date',
      label: 'Fecha Efectiva',
      width: '15%',
      transform: (val) => new Date(val).toLocaleDateString(),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit-2',
      variant: 'ghost',
      action: (item) => this.openEditModal(item),
    },
    {
      label: 'Activar',
      icon: 'check-circle',
      variant: 'success',
      show: (item) => !item.is_active,
      action: (item) => this.toggleActivation(item),
    },
    {
      label: 'Desactivar',
      icon: 'slash',
      variant: 'danger',
      show: (item) => item.is_active,
      action: (item) => this.toggleActivation(item),
    },
  ];

  ngOnInit() {
    this.initFilters();
    this.loadDocuments();

    // Subscribe to filter changes
    this.typeFilterControl.valueChanges.subscribe(() => {
      // computed 'filteredDocuments' will update automatically,
      // but if we were fetching from server with pagination/filter, we would call loadDocuments here.
      // Since we filter client-side for now (as per original code), no need to re-fetch.
    });
  }

  initFilters() {
    this.typeFilterOptions = Object.values(LegalDocumentTypeEnum).map(
      (type) => ({
        label: this.formatEnumLabel(type),
        value: type,
      }),
    );
  }

  loadDocuments() {
    this.loading.set(true);
    // Fetch all for client-side filtering as per original pattern
    this.service.getSystemDocuments({}).subscribe({
      next: (docs) => {
        this.documents.set(docs);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading documents', err);
        this.toast.error('Error al cargar los documentos legales');
        this.loading.set(false);
      },
    });
  }

  onSearch(query: string) {
    this.searchQuery.set(query);
  }

  openCreateModal() {
    this.selectedDocument = undefined;
    this.isModalOpen = true;
  }

  openEditModal(doc: LegalDocument) {
    this.loading.set(true);
    this.service.getSystemDocument(doc.id).subscribe({
      next: (fullDoc) => {
        this.selectedDocument = fullDoc;
        this.isModalOpen = true;
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading document details', err);
        this.toast.error('Error al cargar los detalles del documento');
        this.loading.set(false);
      },
    });
  }

  closeModal() {
    this.isModalOpen = false;
    this.selectedDocument = undefined;
  }

  onSaveDocument(dto: CreateSystemDocumentDto | UpdateSystemDocumentDto) {
    if (this.selectedDocument) {
      // Edit
      this.service
        .updateSystemDocument(
          this.selectedDocument.id,
          dto as UpdateSystemDocumentDto,
        )
        .subscribe({
          next: () => {
            this.toast.success('Documento actualizado correctamente');
            this.closeModal();
            this.loadDocuments();
          },
          error: (err) => {
            console.error(err);
            this.toast.error('Error al actualizar el documento');
          },
        });
    } else {
      // Create
      this.service
        .createSystemDocument(dto as CreateSystemDocumentDto)
        .subscribe({
          next: () => {
            this.toast.success('Documento creado correctamente');
            this.closeModal();
            this.loadDocuments();
          },
          error: (err) => {
            console.error(err);
            this.toast.error(
              err.error?.message || 'Error al crear el documento',
            );
          },
        });
    }
  }

  toggleActivation(doc: LegalDocument) {
    if (doc.is_active) {
      if (!confirm('¿Estás seguro de desactivar este documento?')) return;

      this.service.deactivateDocument(doc.id).subscribe({
        next: () => {
          this.toast.success('Documento desactivado');
          this.loadDocuments();
        },
        error: () => this.toast.error('Error al desactivar'),
      });
    } else {
      if (
        !confirm(
          'Al activar este documento, se desactivarán otras versiones del mismo tipo. ¿Continuar?',
        )
      )
        return;

      this.service.activateDocument(doc.id).subscribe({
        next: () => {
          this.toast.success('Documento activado');
          this.loadDocuments();
        },
        error: () => this.toast.error('Error al activar'),
      });
    }
  }

  formatEnumLabel(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
}
