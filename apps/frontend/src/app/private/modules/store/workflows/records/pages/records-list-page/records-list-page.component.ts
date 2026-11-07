import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertBannerComponent,
  CardComponent,
  DialogService,
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import { CollectionView, RecordRow } from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';
import { formatRecordValue } from '../../utils/records-ui.util';

/** Columns beyond reference and title (the rest is in the detail). */
const EXTRA_COLUMNS = 3;

type RecordView = RecordRow & Record<string, unknown>;

/** `/admin/workflows/records/collections/:collectionId`: records of one collection. */
@Component({
  selector: 'app-records-list-page',
  standalone: true,
  providers: [CurrencyPipe],
  imports: [
    AlertBannerComponent,
    CardComponent,
    EmptyStateComponent,
    InputsearchComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="collection()?.name ?? 'Registros'"
        [subtitle]="collection()?.description || 'Registros de esta colección'"
        [icon]="collection()?.icon || 'folder-open'"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows/records"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      @if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ loadError() }}</app-alert-banner>
      } @else if (collection(); as c) {
        <div class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent">
          <app-stats
            [title]="c.name"
            [value]="totalItems()"
            smallText="Registros activos"
            iconName="folder-open"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [loading]="loading()"
          />
        </div>

        <app-card [responsive]="true" [padding]="false" overflow="visible">
          <div
            class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
                {{ c.name }} ({{ totalItems() }})
              </h2>
              <app-inputsearch
                class="w-full md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar por título o referencia..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              />
            </div>
          </div>

          @if (listError()) {
            <app-alert-banner variant="danger" icon="alert-circle">{{ listError() }}</app-alert-banner>
          } @else if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando...</p>
            </div>
          } @else if (totalItems() === 0) {
            <app-empty-state
              icon="folder-open"
              [title]="searchTerm() ? 'Ningún registro coincide con tu búsqueda' : 'Aún no hay registros'"
              [description]="searchTerm() ? 'Prueba con otro título o referencia.' : 'Crea el primero para empezar.'"
              [actionButtonText]="'Nuevo ' + c.item_name.toLowerCase()"
              [showActionButton]="!searchTerm()"
              (actionClick)="create()"
            />
          } @else {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns()"
                [actions]="actions"
                [cardConfig]="card()"
                [sortable]="false"
                emptyMessage="No hay registros"
                emptyIcon="folder-open"
                (rowClick)="open($event)"
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
      } @else {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando colección...</p>
      }
    </div>
  `,
})
export class RecordsListPageComponent implements OnInit {
  private readonly api = inject(RecordsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly currencyPipe = inject(CurrencyPipe);
  private readonly destroyRef = inject(DestroyRef);

  readonly limit = 10;
  readonly collection = signal<CollectionView | null>(null);
  readonly records = signal<RecordRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly listError = signal('');
  readonly searchTerm = signal('');
  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit) || 1);

  readonly headerActions = computed(() => {
    const c = this.collection();
    return c
      ? [
          { id: 'design', label: 'Diseñar', icon: 'pencil', variant: 'outline' as const },
          { id: 'new', label: `Nuevo ${c.item_name.toLowerCase()}`, icon: 'plus', variant: 'primary' as const },
        ]
      : [];
  });

  private readonly displayFields = computed(() => {
    const c = this.collection();
    if (!c) return [];
    return c.fields.filter((f) => f.key !== c.title_field).slice(0, EXTRA_COLUMNS);
  });

  /** Rows with each shown value already formatted under `d_<key>`. */
  readonly rows = computed<RecordView[]>(() =>
    this.records().map((r) => {
      const view: RecordView = { ...r };
      for (const f of this.displayFields()) {
        view[`d_${f.key}`] = formatRecordValue(f, r.values[f.key], (n) => this.currencyPipe.transform(n));
      }
      return view;
    }),
  );

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'reference', label: 'Referencia', priority: 1, width: '140px' },
    { key: 'title', label: 'Título', priority: 1 },
    ...this.displayFields().map((f, i) => ({
      key: `d_${f.key}`,
      label: f.label,
      priority: 2 + i,
      defaultValue: '—',
    })),
  ]);

  readonly card = computed<ItemListCardConfig>(() => ({
    titleKey: 'title',
    subtitleKey: 'reference',
    avatarFallbackIcon: this.collection()?.icon || 'folder-open',
    avatarShape: 'square',
    detailKeys: this.displayFields().map((f) => ({ key: `d_${f.key}`, label: f.label, defaultValue: '—' })),
  }));

  readonly actions: TableAction[] = [
    {
      label: 'Abrir',
      icon: 'folder-open',
      variant: 'info',
      action: (row: RecordRow) => this.open(row),
    },
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'info',
      action: (row: RecordRow) => this.router.navigate(['/admin/workflows/records', row.id, 'edit']),
    },
    {
      label: 'Archivar',
      icon: 'archive',
      variant: 'muted',
      action: (row: RecordRow) => this.archive(row),
    },
  ];

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('collectionId'));
    if (!Number.isInteger(id) || id < 1) {
      this.loadError.set('No se encontró la colección.');
      return;
    }
    this.api
      .getCollection(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.collection.set(c);
          this.load();
        },
        error: (error) => {
          this.loadError.set(toWorkflowError(error).message);
          this.loading.set(false);
        },
      });
  }

  onHeaderAction(id: string): void {
    const c = this.collection();
    if (!c) return;
    if (id === 'new') this.create();
    if (id === 'design') this.router.navigate(['/admin/workflows/records/collections', c.id, 'edit']);
  }

  create(): void {
    const c = this.collection();
    if (c) this.router.navigate(['/admin/workflows/records/collections', c.id, 'new']);
  }

  open(row: RecordRow): void {
    this.router.navigate(['/admin/workflows/records', row.id]);
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

  async archive(row: RecordRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Archivar registro',
      message: `¿Archivar "${row.title}" (${row.reference})? Sale de la lista; sus solicitudes y su expediente se conservan.`,
      confirmText: 'Archivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .archiveRecord(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Registro archivado');
          this.load();
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  private load(): void {
    const c = this.collection();
    if (!c) return;
    this.loading.set(true);
    this.listError.set('');
    this.api
      .listRecords({
        collection_id: c.id,
        page: this.page(),
        limit: this.limit,
        search: this.searchTerm().trim(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.records.set(res.data ?? []);
          this.totalItems.set(res.meta?.total ?? 0);
          this.loading.set(false);
        },
        error: (error) => {
          this.listError.set(toWorkflowError(error).message);
          this.loading.set(false);
        },
      });
  }
}
