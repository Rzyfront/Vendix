import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../shared/components';
import {
  AdCreativeFormat,
  AdCreativeStatus,
  MarketingAdCreative,
  MarketingAdCreativeSummary,
} from './anuncios.interface';
import { AnunciosService } from './anuncios.service';

interface FileSaveWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSaveHandle {
  createWritable(): Promise<FileSaveWritable>;
}

type FileSaveWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSaveHandle>;
};

@Component({
  selector: 'app-anuncios',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
  ],
  template: `
    <div class="w-full">
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Anuncios"
          [value]="summary()?.total ?? anuncios().length"
          smallText="Creatividades creadas"
          iconName="image"
          iconBgColor="bg-sky-100"
          iconColor="text-sky-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Listos"
          [value]="summary()?.completed ?? completedCount()"
          smallText="Disponibles para publicar"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Procesando"
          [value]="summary()?.processing ?? processingCount()"
          smallText="Generaciones activas"
          iconName="loader-2"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Fallidos"
          [value]="summary()?.failed ?? failedCount()"
          smallText="Requieren reintento"
          iconName="triangle-alert"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
          [loading]="loading()"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card
          [responsive]="true"
          [padding]="false"
          customClasses="md:min-h-[600px]"
        >
          <div
            class="sticky top-[99px] z-10 -mt-[5px] bg-background px-2 py-1.5 md:static md:mt-0 md:border-b md:border-border md:bg-transparent md:px-6 md:py-4"
          >
            <div
              class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4"
            >
              <h2
                class="text-[13px] font-semibold tracking-wide text-text-secondary md:text-lg md:font-semibold md:tracking-normal md:text-text-primary"
              >
                Anuncios
                <span
                  class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary"
                >
                  ({{ summary()?.total ?? anuncios().length }})
                </span>
              </h2>

              <div class="flex w-full items-center gap-2 md:w-auto">
                <app-inputsearch
                  class="flex-1 rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:w-64 md:shadow-none"
                  size="sm"
                  placeholder="Buscar anuncios..."
                  [debounceTime]="700"
                  [formControl]="searchControl"
                  (searchChange)="onSearchInput($event)"
                ></app-inputsearch>

                <select
                  class="h-10 min-w-28 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.07)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 md:min-w-36 md:shadow-none"
                  [value]="statusFilter()"
                  (change)="onStatusChange(statusSelect.value)"
                  #statusSelect
                  aria-label="Filtrar por estado"
                >
                  <option value="">Todos</option>
                  <option value="draft">Borrador</option>
                  <option value="processing">Procesando</option>
                  <option value="completed">Listos</option>
                  <option value="failed">Fallidos</option>
                </select>

                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  title="Nuevo anuncio"
                  (clicked)="goToCreatePage()"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
                </app-button>
              </div>
            </div>
          </div>

          <div class="px-2 pb-2 pt-3 md:p-4">
            @if (error() && anuncios().length) {
              <app-alert-banner variant="danger" icon="triangle-alert">
                {{ error() }}
              </app-alert-banner>
            }

            <app-responsive-data-view
              [data]="displayAnuncios()"
              [columns]="tableColumns"
              [actions]="tableActions"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              [sortable]="true"
              emptyIcon="image-plus"
              [emptyTitle]="emptyAnunciosTitle()"
              [emptyDescription]="emptyAnunciosDescription()"
              emptyActionText="Crear anuncio"
              emptyActionIcon="sparkles"
              [showEmptyAction]="!error() && !hasAnunciosFilters()"
              [showEmptyRefresh]="!!error()"
              [showEmptyClearFilters]="hasAnunciosFilters()"
              (rowClick)="openPreviewModal($event)"
              (emptyActionClick)="goToCreatePage()"
              (emptyRefreshClick)="refreshAnuncios()"
              (emptyClearFiltersClick)="clearFilters()"
            ></app-responsive-data-view>
          </div>
        </app-card>
      </div>

      <app-modal
        [(isOpen)]="showGenerationModal"
        title="Generando anuncio"
        [subtitle]="generationMessage()"
        size="lg"
        [closeOnBackdrop]="!isGenerating()"
        [closeOnEscape]="!isGenerating()"
      >
        <div class="space-y-4">
          <div
            class="flex aspect-square max-h-[60vh] items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
          >
            @if (generationPreview()) {
              <img
                class="h-full w-full object-contain"
                [src]="generationPreview()"
                alt="Vista previa del anuncio generado"
              />
            } @else {
              <div
                class="flex flex-col items-center gap-3 text-sm text-[var(--color-text-secondary)]"
              >
                <app-icon name="loader-2" [size]="24" [spin]="true"></app-icon>
                Procesando recursos...
              </div>
            }
          </div>

          @if (generationResult()?.image_url) {
            <div class="flex flex-wrap justify-end gap-2">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="copyImage(generationResult()!)"
              >
                <app-icon slot="icon" name="copy" [size]="15"></app-icon>
                Copiar
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="downloadImage(generationResult()!)"
              >
                <app-icon slot="icon" name="download" [size]="15"></app-icon>
                Descargar
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="shareImage(generationResult()!)"
              >
                <app-icon slot="icon" name="share-2" [size]="15"></app-icon>
                Compartir
              </app-button>
            </div>
          }
        </div>

        <div slot="footer" class="flex justify-end">
          <app-button
            variant="primary"
            size="md"
            [disabled]="isGenerating()"
            (clicked)="showGenerationModal.set(false)"
          >
            Cerrar
          </app-button>
        </div>
      </app-modal>

      <app-modal
        [(isOpen)]="showPreviewModal"
        [title]="selectedAnuncio()?.title || 'Anuncio'"
        [subtitle]="selectedAnuncioStatusLabel()"
        size="xl"
        (cancel)="closePreviewModal()"
        (closed)="closePreviewModal()"
      >
        @if (selectedAnuncio()) {
          <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
            <section
              class="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
            >
              @if (selectedAnuncioImageUrl()) {
                <img
                  class="max-h-[70vh] w-full object-contain"
                  [src]="selectedAnuncioImageUrl()!"
                  [alt]="selectedAnuncio()?.title || 'Anuncio'"
                />
              } @else {
                <div
                  class="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-[var(--color-text-secondary)]"
                >
                  <app-icon name="image-off" [size]="36"></app-icon>
                  Este anuncio aun no tiene imagen generada.
                </div>
              }
            </section>

            <aside class="space-y-4">
              <div class="space-y-2">
                <h3
                  class="text-xl font-semibold text-[var(--color-text-primary)]"
                >
                  {{ selectedAnuncio()?.title }}
                </h3>
                <p
                  class="text-sm leading-6 text-[var(--color-text-secondary)]"
                >
                  {{ selectedAnuncioDescription() }}
                </p>
              </div>

              @if (selectedAnuncioProducts()) {
                <div
                  class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
                >
                  <p
                    class="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                  >
                    Productos
                  </p>
                  <p class="text-sm text-[var(--color-text-primary)]">
                    {{ selectedAnuncioProducts() }}
                  </p>
                </div>
              }

              <div
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4"
              >
                <div class="mb-2 flex items-center gap-2">
                  <app-icon
                    name="shopping-bag"
                    [size]="18"
                    class="text-[var(--color-primary)]"
                  ></app-icon>
                  <p
                    class="text-sm font-semibold text-[var(--color-text-primary)]"
                  >
                    Call to action
                  </p>
                </div>

                @if (ecommerceUrlLoading()) {
                  <div
                    class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
                  >
                    <app-icon name="loader-2" [size]="16" [spin]="true"></app-icon>
                    Buscando dominio ecommerce...
                  </div>
                } @else if (ecommerceUrl()) {
                  <p class="text-sm leading-6 text-[var(--color-text-primary)]">
                    Consigue esto y más en
                    <a
                      class="font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline"
                      [href]="ecommerceUrl()!"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ ecommerceUrlLabel() }}
                    </a>
                  </p>
                } @else {
                  <p class="text-sm leading-6 text-[var(--color-text-secondary)]">
                    Consigue esto y más en la tienda online.
                  </p>
                }
              </div>
            </aside>
          </div>
        }

        <div slot="footer" class="flex flex-wrap justify-end gap-2">
          @if (selectedAnuncio()?.image_url) {
            <app-button
              variant="outline"
              size="sm"
              (clicked)="copyImage(selectedAnuncio()!)"
            >
              <app-icon slot="icon" name="copy" [size]="15"></app-icon>
              Copiar
            </app-button>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="downloadImage(selectedAnuncio()!)"
            >
              <app-icon slot="icon" name="download" [size]="15"></app-icon>
              Descargar
            </app-button>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="shareImage(selectedAnuncio()!)"
            >
              <app-icon slot="icon" name="share-2" [size]="15"></app-icon>
              Compartir
            </app-button>
          }
          @if (ecommerceUrl()) {
            <app-button
              variant="primary"
              size="sm"
              (clicked)="openEcommerceUrl()"
            >
              <app-icon slot="icon" name="external-link" [size]="15"></app-icon>
              Abrir tienda
            </app-button>
          }
        </div>
      </app-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class AnunciosComponent {
  private readonly anunciosService = inject(AnunciosService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly anuncios = signal<MarketingAdCreative[]>([]);
  protected readonly summary = signal<MarketingAdCreativeSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<AdCreativeStatus | ''>('');
  protected readonly showGenerationModal = signal(false);
  protected readonly generatingId = signal<number | null>(null);
  protected readonly generationPreview = signal<string | null>(null);
  protected readonly generationResult = signal<MarketingAdCreative | null>(
    null,
  );
  protected readonly generationMessage = signal('Preparando generacion...');
  protected readonly showPreviewModal = signal(false);
  protected readonly selectedAnuncio = signal<MarketingAdCreative | null>(null);
  protected readonly ecommerceUrl = signal<string | null>(null);
  protected readonly ecommerceUrlLoading = signal(false);
  protected readonly ecommerceUrlError = signal<string | null>(null);

  protected readonly searchControl = new FormControl('', {
    nonNullable: true,
  });

  protected readonly tableColumns: TableColumn[] = [
    {
      key: 'preview_url',
      label: '',
      sortable: false,
      width: '56px',
      align: 'center',
      priority: 1,
      type: 'image',
    },
    {
      key: 'title',
      label: 'Anuncio',
      sortable: true,
      width: '260px',
      priority: 1,
      cellClass: () =>
        'font-semibold text-[var(--color-text-primary)] md:text-[var(--color-primary)]',
    },
    {
      key: 'products_label',
      label: 'Productos',
      sortable: false,
      width: '240px',
      priority: 2,
      defaultValue: 'Sin productos',
    },
    {
      key: 'format',
      label: 'Formato',
      sortable: true,
      width: '140px',
      priority: 2,
      transform: (value: AdCreativeFormat) => this.formatLabel(value),
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      width: '120px',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          draft: '#6b7280',
          processing: '#f59e0b',
          completed: '#22c55e',
          failed: '#ef4444',
        },
      },
      transform: (value: AdCreativeStatus) => this.statusLabel(value),
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      width: '170px',
      priority: 3,
      transform: (value?: string | null) => this.formatDateTime(value),
    },
  ];

  protected readonly tableActions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      action: (creative: MarketingAdCreative) =>
        this.openPreviewModal(creative),
      variant: 'ghost',
    },
    {
      label: 'Copiar',
      icon: 'copy',
      action: (creative: MarketingAdCreative) => void this.copyImage(creative),
      variant: 'ghost',
      show: (creative: MarketingAdCreative) => !!creative.image_url,
    },
    {
      label: 'Descargar',
      icon: 'download',
      action: (creative: MarketingAdCreative) => this.downloadImage(creative),
      variant: 'ghost',
      show: (creative: MarketingAdCreative) => !!creative.image_url,
    },
    {
      label: 'Compartir',
      icon: 'share-2',
      action: (creative: MarketingAdCreative) => void this.shareImage(creative),
      variant: 'ghost',
      show: (creative: MarketingAdCreative) => !!creative.image_url,
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (creative: MarketingAdCreative) =>
        void this.deleteAnuncio(creative),
      variant: 'danger',
    },
  ];

  protected readonly cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleTransform: (creative: MarketingAdCreative) =>
      this.descriptionPreview(creative),
    avatarKey: 'preview_url',
    avatarFallbackIcon: 'image',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        draft: '#6b7280',
        processing: '#f59e0b',
        completed: '#22c55e',
        failed: '#ef4444',
      },
    },
    badgeTransform: (value: AdCreativeStatus) => this.statusLabel(value),
    detailKeys: [
      {
        key: 'products_label',
        label: 'Productos',
        icon: 'package',
      },
      {
        key: 'format',
        label: 'Formato',
        icon: 'image',
        transform: (value: AdCreativeFormat) => this.formatLabel(value),
      },
    ],
    footerKey: 'created_at',
    footerLabel: 'Creado',
    footerTransform: (value?: string | null) => this.formatDateTime(value),
  };

  protected readonly displayAnuncios = computed(() =>
    this.anuncios().map((creative) => ({
      ...creative,
      preview_url: this.previewUrl(creative),
      products_label: this.productNames(creative),
      product_count: creative.creative_products?.length || 0,
    })),
  );
  protected readonly hasAnunciosFilters = computed(
    () => !!this.search().trim() || !!this.statusFilter(),
  );
  protected readonly completedCount = computed(
    () => this.anuncios().filter((item) => item.status === 'completed').length,
  );
  protected readonly processingCount = computed(
    () => this.anuncios().filter((item) => item.status === 'processing').length,
  );
  protected readonly failedCount = computed(
    () => this.anuncios().filter((item) => item.status === 'failed').length,
  );
  protected readonly isGenerating = computed(
    () => this.generatingId() !== null,
  );
  protected readonly selectedAnuncioImageUrl = computed(() => {
    const creative = this.selectedAnuncio();
    return creative ? creative.image_url || creative.thumb_url || null : null;
  });
  protected readonly selectedAnuncioDescription = computed(() => {
    const creative = this.selectedAnuncio();
    if (!creative) return '';
    return creative.description || creative.prompt || 'Sin descripcion.';
  });
  protected readonly selectedAnuncioProducts = computed(() => {
    const creative = this.selectedAnuncio();
    return creative ? this.productNames(creative) : '';
  });
  protected readonly selectedAnuncioStatusLabel = computed(() => {
    const creative = this.selectedAnuncio();
    return creative ? this.statusLabel(creative.status) : '';
  });
  protected readonly ecommerceUrlLabel = computed(() =>
    (this.ecommerceUrl() || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, ''),
  );

  constructor() {
    void this.loadAnuncios();
    void this.loadSummary();
  }

  protected async loadAnuncios(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.anunciosService.getAnuncios({
          search: this.search(),
          status: this.statusFilter(),
          limit: 60,
        }),
      );
      this.anuncios.set(response.data || []);
    } catch (error: any) {
      this.error.set(extractApiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async loadSummary(): Promise<void> {
    try {
      const response = await firstValueFrom(this.anunciosService.getSummary());
      this.summary.set(response.data);
    } catch {
      this.summary.set(null);
    }
  }

  protected refreshAnuncios(): void {
    void this.loadAnuncios();
    void this.loadSummary();
  }

  protected goToCreatePage(): void {
    void this.router.navigate(['/admin/marketing/anuncios/create']);
  }

  protected openPreviewModal(creative: MarketingAdCreative): void {
    this.selectedAnuncio.set(creative);
    this.showPreviewModal.set(true);
    void this.ensureEcommerceUrl();
  }

  protected closePreviewModal(): void {
    if (!this.showPreviewModal()) {
      this.selectedAnuncio.set(null);
    }
  }

  protected openEcommerceUrl(): void {
    const url = this.ecommerceUrl();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected startGeneration(id: number): void {
    if (this.generatingId()) return;

    this.generatingId.set(id);
    this.showGenerationModal.set(true);
    this.generationPreview.set(null);
    this.generationResult.set(null);
    this.generationMessage.set('Preparando recursos...');

    this.anunciosService
      .streamGenerate(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === 'progress') {
            this.generationMessage.set(event.message || 'Generando imagen...');
          }

          if (event.type === 'partial_image' && event.imageBase64) {
            this.generationMessage.set('Recibiendo vista previa...');
            this.generationPreview.set(
              `data:image/png;base64,${event.imageBase64}`,
            );
          }

          if (event.type === 'completed' && event.creative) {
            this.generationResult.set(event.creative);
            this.generationPreview.set(event.creative.image_url || null);
            this.generationMessage.set('Anuncio listo.');
            this.replaceAnuncio(event.creative);
          }

          if (event.type === 'done') {
            this.generatingId.set(null);
            void this.loadAnuncios();
            void this.loadSummary();
          }

          if (event.type === 'error') {
            this.generatingId.set(null);
            this.toastService.error(
              event.error || 'No se pudo generar la imagen.',
            );
            void this.loadAnuncios();
            void this.loadSummary();
          }
        },
        error: () => {
          this.generatingId.set(null);
          this.toastService.error('No se pudo conectar con la generacion.');
        },
      });
  }

  protected async deleteAnuncio(creative: MarketingAdCreative): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar anuncio',
      message: `Se eliminara "${creative.title}".`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    });

    if (!confirmed) return;

    try {
      await firstValueFrom(this.anunciosService.deleteAnuncio(creative.id));
      this.toastService.success('Anuncio eliminado.');
      await this.loadAnuncios();
      await this.loadSummary();
    } catch (error: any) {
      this.toastService.error(extractApiErrorMessage(error));
    }
  }

  protected onSearchInput(value: string): void {
    this.search.set(value);
    void this.loadAnuncios();
  }

  protected onStatusChange(value: string): void {
    this.statusFilter.set(value as AdCreativeStatus | '');
    void this.loadAnuncios();
  }

  protected clearFilters(): void {
    this.search.set('');
    this.statusFilter.set('');
    this.searchControl.setValue('', { emitEvent: false });
    this.refreshAnuncios();
  }

  protected emptyAnunciosTitle(): string {
    if (this.error()) return 'No se pudieron cargar los anuncios';
    return this.hasAnunciosFilters()
      ? 'Sin anuncios para estos filtros'
      : 'Aun no tienes anuncios';
  }

  protected emptyAnunciosDescription(): string {
    if (this.error()) return this.error()!;
    return this.hasAnunciosFilters()
      ? 'Ajusta la busqueda o limpia los filtros para ver otros anuncios.'
      : 'Selecciona productos, agrega una idea y deja que la IA genere una pieza visual lista para compartir.';
  }

  protected descriptionPreview(creative: MarketingAdCreative): string {
    return creative.description || creative.prompt || 'Sin descripcion';
  }

  protected productNames(creative: MarketingAdCreative): string {
    return (
      creative.creative_products
        ?.map((item) => item.product?.name)
        .filter(Boolean)
        .join(', ') || ''
    );
  }

  protected previewUrl(creative: MarketingAdCreative): string | null {
    return creative.thumb_url || creative.image_url || null;
  }

  protected statusLabel(status: AdCreativeStatus): string {
    const labels: Record<AdCreativeStatus, string> = {
      draft: 'Borrador',
      processing: 'Procesando',
      completed: 'Listo',
      failed: 'Fallido',
    };
    return labels[status];
  }

  protected formatLabel(format: AdCreativeFormat): string {
    const labels: Record<AdCreativeFormat, string> = {
      square: 'Feed cuadrado',
      story: 'Historia vertical',
      landscape: 'Banner horizontal',
    };
    return labels[format];
  }

  protected formatDateTime(value?: string | null): string {
    if (!value) return 'Sin fecha';
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  protected async copyImage(creative: MarketingAdCreative): Promise<void> {
    if (!creative.image_url) return;
    try {
      const clipboardItem = (window as any).ClipboardItem;
      if (clipboardItem && navigator.clipboard?.write) {
        const response = await fetch(creative.image_url);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new clipboardItem({ [blob.type || 'image/png']: blob }),
        ]);
        this.toastService.success('Imagen copiada.');
        return;
      }
      await navigator.clipboard.writeText(creative.image_url);
      this.toastService.success('Enlace copiado.');
    } catch {
      await navigator.clipboard.writeText(creative.image_url);
      this.toastService.success('Enlace copiado.');
    }
  }

  protected async downloadImage(
    creative: MarketingAdCreative,
  ): Promise<void> {
    if (!creative.image_url) return;

    const fileName = this.imageFileName(creative);
    const savePicker = (window as FileSaveWindow).showSaveFilePicker;

    if (savePicker) {
      try {
        const handle = await savePicker.call(window, {
          suggestedName: fileName,
          types: [
            {
              description: 'Imagen',
              accept: {
                'image/png': ['.png'],
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/webp': ['.webp'],
              },
            },
          ],
        });
        const blob = await this.fetchImageBlob(creative.image_url);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        this.toastService.success('Imagen guardada.');
        return;
      } catch (error) {
        if (this.isSaveCancelled(error)) return;
      }
    }

    this.downloadViaAnchor(creative.image_url, fileName);
    this.toastService.info('Descarga iniciada.');
  }

  private downloadViaAnchor(imageUrl: string, fileName: string): void {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = fileName;
    link.target = '_blank';
    link.click();
  }

  private async fetchImageBlob(imageUrl: string): Promise<Blob> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error('No se pudo descargar la imagen.');
    }
    return response.blob();
  }

  private isSaveCancelled(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  protected async shareImage(creative: MarketingAdCreative): Promise<void> {
    if (!creative.image_url) return;
    if (navigator.share) {
      await navigator.share({
        title: creative.title,
        url: creative.image_url,
      });
      return;
    }
    await navigator.clipboard.writeText(creative.image_url);
    this.toastService.success('Enlace copiado para compartir.');
  }

  private async ensureEcommerceUrl(): Promise<void> {
    if (this.ecommerceUrl() || this.ecommerceUrlLoading()) return;

    this.ecommerceUrlLoading.set(true);
    this.ecommerceUrlError.set(null);
    try {
      const response = await firstValueFrom(
        this.anunciosService.getEcommerceDomain(),
      );
      const domain = response.data;

      if (domain?.url || domain?.hostname) {
        this.ecommerceUrl.set(domain.url || this.toHttpsUrl(domain.hostname));
        return;
      }

      this.ecommerceUrlError.set('No hay dominio ecommerce activo.');
    } catch (error: any) {
      this.ecommerceUrlError.set(extractApiErrorMessage(error));
    } finally {
      this.ecommerceUrlLoading.set(false);
    }
  }

  private replaceAnuncio(creative: MarketingAdCreative): void {
    const current = this.anuncios();
    const index = current.findIndex((item) => item.id === creative.id);
    if (index === -1) {
      this.anuncios.set([creative, ...current]);
      return;
    }
    const updated = [...current];
    updated[index] = creative;
    this.anuncios.set(updated);
  }

  private fileSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
  }

  private imageFileName(creative: MarketingAdCreative): string {
    const extension = this.imageExtensionFromUrl(creative.image_url) || 'webp';
    return `${this.fileSlug(creative.title) || 'anuncio'}.${extension}`;
  }

  private imageExtensionFromUrl(imageUrl?: string | null): string | null {
    if (!imageUrl) return null;

    try {
      const pathname = new URL(imageUrl).pathname;
      const extension = pathname.split('.').pop()?.toLowerCase();
      if (extension && ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
        return extension;
      }
    } catch {
      const extension = imageUrl.split('?')[0]?.split('.').pop()?.toLowerCase();
      if (extension && ['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
        return extension;
      }
    }

    return null;
  }

  private toHttpsUrl(hostname: string): string {
    const cleanHostname = hostname
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return `https://${cleanHostname}`;
  }
}
