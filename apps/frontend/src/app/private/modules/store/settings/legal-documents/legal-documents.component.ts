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
    IconComponent,
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
        IconComponent,
    ],
    template: `
    <div class="md:space-y-4">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Documentos"
          [value]="totalDocuments()"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        ></app-stats>

        <app-stats
          title="Activos"
          [value]="activeDocumentsCount()"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
        ></app-stats>

        <app-stats
          title="Tipos de Tienda"
          [value]="documentTypesCount()"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
        ></app-stats>

        <app-stats
          title="Última Actualización"
          [value]="lastUpdateFormatted()"
          iconName="clock"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
        ></app-stats>
      </div>

      <!-- Main Card (desktop only styling) -->
      <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border md:min-h-[600px] md:overflow-hidden">
        <!-- Search Section (sticky mobile) -->
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Documentos ({{ totalDocuments() }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar documentos..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              ></app-inputsearch>
              <app-button
                variant="outline"
                size="sm"
                customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="openCreateModal()"
                title="Nuevo Documento"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Loading -->
        <div *ngIf="loading()" class="p-4 md:p-6 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando documentos...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!loading() && filteredDocuments().length === 0" class="p-8 md:p-16 text-center">
          <div class="flex justify-center mb-4">
            <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <app-icon name="file-text" [size]="28" class="text-gray-400"></app-icon>
            </div>
          </div>
          <h3 class="text-lg font-medium text-text-primary">{{ searchQuery() ? 'Sin resultados' : 'Sin documentos' }}</h3>
          <p class="text-text-secondary mt-1">{{ searchQuery() ? 'Intenta con otro término de búsqueda' : 'Crea tu primer documento legal' }}</p>
          <app-button *ngIf="searchQuery()" variant="outline" size="sm" class="mt-4" (clicked)="onSearch('')">Limpiar búsqueda</app-button>
        </div>

        <!-- Data -->
        <div *ngIf="!loading() && filteredDocuments().length > 0" class="px-2 pb-2 pt-3 md:p-4">
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
