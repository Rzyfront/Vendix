import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  CardComponent,
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { apiErrorMessage } from '../../../workflows/utils/workflow-errors.util';
import { TemplateRow } from '../../interfaces/document-template.interfaces';
import { DocumentTemplatesApiService } from '../../services/document-templates-api.service';

interface TemplateView extends TemplateRow {
  kind_text: string;
  status_text: string;
  version_text: string;
  updated_text: string;
}

const KIND_TEXT = { blocks: 'Por bloques', base_pdf: 'Desde un PDF base' } as const;
const STATUS_TEXT = { draft: 'Borrador', published: 'Publicada', archived: 'Archivada' } as const;

/** "Plantillas": the templates of the store, their state and published version. */
@Component({
  selector: 'app-templates-list-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Plantillas para emitir contratos, cartas y formatos con los datos de cada solicitud"
        icon="folder-open"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="stats-container sticky top-[52px] z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Publicadas"
          [value]="published()"
          smallText="Listas para usar en un flujo"
          iconName="file-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        />
        <app-stats
          title="Borradores"
          [value]="drafts()"
          smallText="Pendientes de publicar"
          iconName="file-text"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
              Plantillas ({{ rows().length }})
            </h2>
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar plantilla..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            />
          </div>
        </div>

        @if (loading()) {
          <div class="p-4 text-center md:p-6">
            <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            <p class="mt-2 text-text-secondary">Cargando plantillas...</p>
          </div>
        } @else if (loadError()) {
          <app-empty-state icon="alert-triangle" title="No se pudieron cargar las plantillas" [description]="loadError()" [showActionButton]="false" />
        } @else if (rows().length === 0) {
          <app-empty-state
            icon="file-text"
            [title]="searchTerm() ? 'Ninguna plantilla coincide con tu búsqueda' : 'Aún no hay plantillas'"
            [description]="canDesign() ? 'Crea la primera con «Nueva plantilla».' : 'Quien diseña los flujos puede crearlas.'"
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
              emptyMessage="No hay plantillas"
              emptyIcon="file-text"
              (rowClick)="open($event)"
            />
          </div>
        }
      </app-card>
    </div>
  `,
})
export class TemplatesListPageComponent implements OnInit {
  private readonly api = inject(DocumentTemplatesApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly canDesign = signal(this.auth.isOwner() || this.auth.hasPermission('store:workflows:design'));
  readonly headerActions = computed(() => [
    {
      id: 'new',
      label: 'Nueva plantilla',
      icon: 'plus',
      variant: 'primary' as const,
      visible: this.canDesign(),
    },
  ]);

  readonly searchTerm = signal('');
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly templates = signal<TemplateRow[]>([]);

  readonly published = computed(() => this.templates().filter((t) => t.status === 'published').length);
  readonly drafts = computed(() => this.templates().filter((t) => t.status === 'draft').length);

  readonly rows = computed<TemplateView[]>(() =>
    this.templates().map((t) => ({
      ...t,
      kind_text: KIND_TEXT[t.kind],
      status_text: STATUS_TEXT[t.status],
      version_text: t.published_version ? `v${t.published_version.version}` : '—',
      updated_text: formatStoreDateTime(t.updated_at, this.settings.timezone()),
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', priority: 1 },
    { key: 'key', label: 'Clave', priority: 2, width: '180px' },
    { key: 'kind_text', label: 'Tipo', priority: 2, width: '160px' },
    { key: 'status_text', label: 'Estado', priority: 1, width: '120px' },
    { key: 'version_text', label: 'Versión', priority: 2, width: '90px', align: 'center' },
    { key: 'updated_text', label: 'Actualizada', priority: 3, width: '160px' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'key',
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    detailKeys: [
      { key: 'kind_text', label: 'Tipo', icon: 'layout' },
      { key: 'status_text', label: 'Estado', icon: 'circle-check' },
      { key: 'version_text', label: 'Versión', icon: 'tag' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Abrir',
      icon: 'pencil',
      variant: 'info',
      action: (row: TemplateRow) => this.open(row),
    },
  ];

  ngOnInit(): void {
    this.load();
  }

  onHeaderAction(id: string): void {
    if (id === 'new') this.router.navigate(['/admin/documents/templates/new']);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.load();
  }

  open(row: TemplateRow): void {
    this.router.navigate(['/admin/documents/templates', row.id]);
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .list({ search: this.searchTerm() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.templates.set(rows);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.loadError.set(apiErrorMessage(error));
          this.toast.error(apiErrorMessage(error));
        },
      });
  }
}
