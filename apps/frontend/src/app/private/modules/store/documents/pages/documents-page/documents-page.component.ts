import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { DocumentsTabsComponent } from '../../components/documents-tabs.component';
import { DossierFilesListComponent } from '../../components/dossier-files-list.component';
import { toWorkflowError } from '../../../workflows/utils/workflow-errors.util';
import { DossierDetail, DossierRow } from '../../interfaces/document.interfaces';
import { DocumentsApiService } from '../../services/documents-api.service';

interface DossierView extends DossierRow {
  items_text: string;
  created_text: string;
  request_text: string;
}

@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    ModalComponent,
    ButtonComponent,
    DocumentsTabsComponent,
    DossierFilesListComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Expedientes con los archivos de cada solicitud"
        icon="folder-open"
        variant="glass"
      />
      <app-documents-tabs active="dossiers" />

      <div class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Expedientes"
          [value]="totalItems()"
          smallText="Registrados en la tienda"
          iconName="folder-open"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        />
        <app-stats
          title="Archivos"
          [value]="filesInPage()"
          smallText="En esta página"
          iconName="file-text"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Expedientes ({{ totalItems() }})
            </h2>
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar expediente..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            />
          </div>
        </div>

        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando expedientes...</p>
          </div>
        } @else if (totalItems() === 0) {
          <app-empty-state
            icon="folder-open"
            [title]="searchTerm() ? 'Ningún expediente coincide con tu búsqueda' : 'Aún no hay expedientes'"
            description="Cada solicitud de un flujo crea su expediente automáticamente."
            [showActionButton]="false"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [actions]="actions"
              [cardConfig]="cardConfig"
              [sortable]="false"
              emptyMessage="No hay expedientes"
              emptyIcon="folder-open"
              (rowClick)="openDossier($event)"
            />
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="totalItems()"
                [limit]="limit"
                (pageChange)="onPageChange($event)"
              />
            </div>
          </div>
        }
      </app-card>
    </div>

    <app-modal
      [isOpen]="modalOpen()"
      (isOpenChange)="modalOpen.set($event)"
      [title]="selected()?.reference ?? 'Expediente'"
      [subtitle]="selected()?.title ?? ''"
      size="lg"
    >
      @if (detailLoading()) {
        <p class="text-sm text-text-secondary">Cargando archivos...</p>
      } @else {
        <app-dossier-files-list [items]="selectedItems()" />
      }
      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="modalOpen.set(false)">Cerrar</app-button>
        @if (selected()?.workflow_instance_id) {
          <app-button variant="primary" (clicked)="goToRequest(selected()!)">Ver solicitud</app-button>
        }
      </div>
    </app-modal>
  `,
})
export class DocumentsPageComponent implements OnInit {
  private readonly api = inject(DocumentsApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = 10;
  readonly page = signal(1);
  readonly searchTerm = signal('');
  readonly totalItems = signal(0);
  readonly loading = signal(false);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit) || 1);

  readonly dossiers = signal<DossierRow[]>([]);
  /** Details loaded on demand when a dossier is opened. */
  readonly details = signal<Record<number, DossierDetail>>({});

  readonly modalOpen = signal(false);
  readonly selected = signal<DossierRow | null>(null);
  readonly detailLoading = signal(false);
  readonly selectedItems = computed(() => {
    const row = this.selected();
    return row ? (this.details()[row.id]?.items ?? []) : [];
  });

  readonly rows = computed<DossierView[]>(() =>
    this.dossiers().map((row) => {
      return {
        ...row,
        items_text: String(row.items_count),
        created_text: formatStoreDateTime(row.created_at, this.settings.timezone()),
        request_text: row.workflow_instance_id ? 'Ver solicitud' : '—',
      };
    }),
  );

  readonly filesInPage = computed(() =>
    this.dossiers().reduce((sum, row) => sum + row.items_count, 0),
  );

  readonly columns: TableColumn[] = [
    { key: 'reference', label: 'Referencia', priority: 1, width: '130px' },
    { key: 'title', label: 'Título', priority: 1, defaultValue: '—' },
    { key: 'request_text', label: 'Solicitud', priority: 2, width: '140px' },
    { key: 'items_text', label: 'Archivos', priority: 2, width: '100px', align: 'center' },
    { key: 'created_text', label: 'Fecha', priority: 2, width: '150px' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'reference',
    subtitleKey: 'title',
    avatarFallbackIcon: 'folder-open',
    avatarShape: 'square',
    detailKeys: [
      { key: 'items_text', label: 'Archivos', icon: 'file-text' },
      { key: 'created_text', label: 'Fecha', icon: 'clock' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Ver archivos',
      icon: 'folder-open',
      variant: 'info',
      action: (row: DossierRow) => this.openDossier(row),
    },
    {
      label: 'Ver solicitud',
      icon: 'external-link',
      variant: 'muted',
      show: (row: DossierRow) => !!row.workflow_instance_id,
      action: (row: DossierRow) => this.goToRequest(row),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.page.set(1);
    this.load();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  openDossier(row: DossierRow): void {
    this.selected.set(row);
    this.modalOpen.set(true);
    if (this.details()[row.id]) return;
    this.detailLoading.set(true);
    this.api.getDossier(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (detail) => {
        this.details.update((current) => ({ ...current, [row.id]: detail }));
        this.detailLoading.set(false);
      },
      error: (error) => {
        this.detailLoading.set(false);
        this.toast.error(toWorkflowError(error).message);
      },
    });
  }

  goToRequest(row: DossierRow): void {
    if (!row.workflow_instance_id) return;
    this.modalOpen.set(false);
    this.router.navigate(['/admin/workflows/instances', row.workflow_instance_id]);
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .listDossiers({
        page: this.page(),
        limit: this.limit,
        search: this.searchTerm() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data ?? [];
          this.dossiers.set(data);
          this.totalItems.set(res.meta?.total ?? data.length);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.toast.error(toWorkflowError(error).message);
        },
      });
  }
}
