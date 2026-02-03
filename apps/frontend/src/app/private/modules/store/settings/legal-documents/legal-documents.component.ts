import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { StoreLegalDocumentsService } from './services/store-legal-documents.service';
import {
    StoreLegalDocument,
    CreateStoreDocumentDto,
    UpdateStoreDocumentDto,
} from './interfaces/store-legal-document.interface';
import { StoreLegalDocumentModalComponent } from './components/store-legal-document-modal/store-legal-document-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import {
    TableColumn,
    TableAction,
} from '../../../../../shared/components/table/table.component';
import {
    ResponsiveDataViewComponent,
    ItemListCardConfig,
} from '../../../../../shared/components/index';

@Component({
    selector: 'app-legal-documents',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ReactiveFormsModule,
        StoreLegalDocumentModalComponent,
        ButtonComponent,
        StatsComponent,
        InputsearchComponent,
        ResponsiveDataViewComponent,
    ],
    template: `
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
          title="Tipos de Tienda"
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
      <div class="flex flex-col bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="p-4 md:px-6 md:py-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-surface">
          <div class="flex-1 min-w-0">
            <h3 class="text-lg font-semibold text-text-primary">
              Documentos Legales de la Tienda
            </h3>
            <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
              Administra tus propios términos y condiciones. Si no configuras ninguno, se usarán los del sistema.
            </p>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <div class="w-full sm:w-60">
              <app-inputsearch
                placeholder="Buscar..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
                size="sm"
                fullWidth="true"
              ></app-inputsearch>
            </div>

            <div class="flex gap-2 items-center sm:ml-auto">
              <app-button
                variant="primary"
                size="sm"
                iconName="plus"
                (clicked)="openCreateModal()"
              >
                Nuevo Documento
              </app-button>
            </div>
          </div>
        </div>

        <div class="relative min-h-[400px] p-2 md:p-4">
          <div *ngIf="loading()" class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>

          <app-responsive-data-view
            [data]="filteredDocuments()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            emptyMessage="No se encontraron documentos"
            emptyIcon="file-text"
          >
          </app-responsive-data-view>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <app-store-legal-document-modal
      [(isOpen)]="isModalOpen"
      [document]="selectedDocument"
      (save)="onSaveDocument($event)"
      (cancel)="closeModal()"
    ></app-store-legal-document-modal>
  `,
})
export class LegalDocumentsComponent implements OnInit {
    private service = inject(StoreLegalDocumentsService);
    private toast = inject(ToastService);

    documents = signal<StoreLegalDocument[]>([]);
    loading = signal<boolean>(false);
    searchQuery = signal<string>('');

    totalDocuments = computed(() => this.documents().length);
    activeDocumentsCount = computed(() => this.documents().filter((d) => d.is_active).length);
    documentTypesCount = computed(() => new Set(this.documents().map((d) => d.document_type)).size);
    lastUpdateFormatted = computed(() => {
        const docs = this.documents();
        if (docs.length === 0) return 'N/A';
        const dates = docs.map((d) => new Date(d.updated_at || d.created_at || '').getTime());
        const maxDate = new Date(Math.max(...dates));
        return maxDate.toLocaleDateString();
    });

    filteredDocuments = computed(() => {
        const query = this.searchQuery().toLowerCase();
        return this.documents().filter((doc) => {
            const matchesSearch =
                doc.title.toLowerCase().includes(query) ||
                doc.version.toLowerCase().includes(query) ||
                this.formatEnumLabel(doc.document_type).toLowerCase().includes(query);
            return matchesSearch;
        });
    });

    isModalOpen = false;
    selectedDocument?: StoreLegalDocument;

    cardConfig: ItemListCardConfig = {
        titleKey: 'title',
        subtitleKey: 'document_type',
        subtitleTransform: (val: string) => this.formatEnumLabel(val),
        badgeKey: 'is_active',
        badgeConfig: { type: 'status' },
        badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
        detailKeys: [
            { key: 'version', label: 'Versión' },
            {
                key: 'effective_date',
                label: 'Fecha Efectiva',
                transform: (val: string) => new Date(val).toLocaleDateString(),
            },
        ],
    };

    columns: TableColumn[] = [
        { key: 'title', label: 'Título', width: '35%' },
        {
            key: 'document_type',
            label: 'Tipo',
            width: '20%',
            transform: (val: string) => this.formatEnumLabel(val),
        },
        { key: 'version', label: 'Versión', width: '10%', badge: true },
        {
            key: 'is_active',
            label: 'Estado',
            width: '15%',
            badge: true,
            transform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
            badgeConfig: { type: 'status' },
        },
        {
            key: 'effective_date',
            label: 'Fecha Efectiva',
            width: '20%',
            transform: (val: string) => new Date(val).toLocaleDateString(),
        },
    ];

    actions: TableAction[] = [
        {
            label: 'Editar',
            icon: 'edit-2',
            variant: 'ghost',
            action: (item: StoreLegalDocument) => this.openEditModal(item),
        },
        {
            label: 'Activar',
            icon: 'check-circle',
            variant: 'success',
            show: (item: StoreLegalDocument) => !item.is_active,
            action: (item: StoreLegalDocument) => this.toggleActivation(item),
        },
        {
            label: 'Desactivar',
            icon: 'slash',
            variant: 'danger',
            show: (item: StoreLegalDocument) => item.is_active,
            action: (item: StoreLegalDocument) => this.toggleActivation(item),
        },
        {
            label: 'Eliminar',
            icon: 'trash-2',
            variant: 'danger',
            show: (item: StoreLegalDocument) => !item.is_active,
            action: (item: StoreLegalDocument) => this.deleteDocument(item),
        },
    ];

    ngOnInit() {
        this.loadDocuments();
    }

    loadDocuments() {
        this.loading.set(true);
        this.service.getDocuments().subscribe({
            next: (docs) => {
                this.documents.set(docs);
                this.loading.set(false);
            },
            error: (err: any) => {
                console.error('Error loading documents', err);
                this.toast.error('Error al cargar los documentos');
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

    openEditModal(doc: StoreLegalDocument) {
        this.loading.set(true);
        this.service.getDocument(doc.id).subscribe({
            next: (fullDoc) => {
                this.selectedDocument = fullDoc;
                this.isModalOpen = true;
                this.loading.set(false);
            },
            error: (err: any) => {
                console.error('Error details', err);
                this.toast.error('Error al cargar los detalles');
                this.loading.set(false);
            },
        });
    }

    closeModal() {
        this.isModalOpen = false;
        this.selectedDocument = undefined;
    }

    onSaveDocument(dto: CreateStoreDocumentDto | UpdateStoreDocumentDto) {
        if (this.selectedDocument) {
            this.service
                .updateDocument(this.selectedDocument.id, dto as UpdateStoreDocumentDto)
                .subscribe({
                    next: () => {
                        this.toast.success('Documento actualizado');
                        this.closeModal();
                        this.loadDocuments();
                    },
                    error: (err: any) => {
                        console.error(err);
                        this.toast.error('Error al actualizar');
                    },
                });
        } else {
            this.service
                .createDocument(dto as CreateStoreDocumentDto)
                .subscribe({
                    next: () => {
                        this.toast.success('Documento creado');
                        this.closeModal();
                        this.loadDocuments();
                    },
                    error: (err: any) => {
                        console.error(err);
                        this.toast.error(err.error?.message || 'Error al crear');
                    },
                });
        }
    }

    toggleActivation(doc: StoreLegalDocument) {
        if (doc.is_active) {
            if (!confirm('¿Desactivar este documento?')) return;
            this.service.deactivateDocument(doc.id).subscribe({
                next: () => {
                    this.toast.success('Documento desactivado');
                    this.loadDocuments();
                },
                error: () => this.toast.error('Error al desactivar'),
            });
        } else {
            if (!confirm('Al activar este documento, se desactivarán otras versiones del mismo tipo. ¿Continuar?')) return;
            this.service.activateDocument(doc.id).subscribe({
                next: () => {
                    this.toast.success('Documento activado');
                    this.loadDocuments();
                },
                error: () => this.toast.error('Error al activar'),
            });
        }
    }

    deleteDocument(doc: StoreLegalDocument) {
        if (!confirm('¿Estás seguro de eliminar este documento? Esta acción no se puede deshacer.')) return;
        this.service.deleteDocument(doc.id).subscribe({
            next: () => {
                this.toast.success('Documento eliminado');
                this.loadDocuments();
            },
            error: () => this.toast.error('Error al eliminar'),
        });
    }

    formatEnumLabel(type: string): string {
        return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    }
}
