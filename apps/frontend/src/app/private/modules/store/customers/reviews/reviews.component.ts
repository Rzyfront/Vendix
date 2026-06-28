import { Component, inject, signal, DestroyRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { AdminReviewsService } from './services/reviews.service';
import { Review, ReviewStats, ReviewFilters } from './models/review.model';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { PaginationComponent } from '../../../../../shared/components/pagination/pagination.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { translateCustomerError } from '../utils/customer-error.translator';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';

@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [
    DecimalPipe,
    FormsModule,
    StatsComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    IconComponent,
    ModalComponent,
  ],
  template: `
    <!-- Stats: sticky on mobile, static on desktop -->
    @if (stats()) {
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Pendientes"
          [value]="stats()!.pending_count"
          smallText="Por aprobar"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Aprobadas"
          [value]="stats()!.approved_count"
          smallText="Reseñas visibles"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Calificación promedio"
          [value]="
            stats()!.average_rating !== null
              ? (stats()!.average_rating! | number: '1.1-1') + ' ★'
              : 'N/A'
          "
          smallText="Sobre 5.0"
          iconName="star"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Reportadas"
          [value]="stats()!.flagged_count"
          smallText="Requieren revisión"
          iconName="flag"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
      </div>
    }

    <!-- Card container -->
    <app-card [responsive]="true" [padding]="false">
      <!-- Search: sticky below stats on mobile -->
      <div
        class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                  md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
      >
        <div
          class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
        >
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
          >
            Reseñas ({{ totalItems() }})
          </h2>
          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              placeholder="Buscar por producto o cliente..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            ></app-inputsearch>
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              (filterChange)="onFilterChange($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="p-4 md:p-6 text-center">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"
          ></div>
        </div>
      }

      @if (listError()) {
        <div
          class="mx-2 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 md:mx-4"
        >
          {{ listError() }}
        </div>
      }

      <!-- Data + Pagination -->
      @if (!loading()) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="reviews()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            emptyMessage="No hay reseñas para mostrar"
            emptyIcon="star"
            (rowClick)="openDetail($event)"
          ></app-responsive-data-view>
          @if (totalPages() > 1) {
            <app-pagination
              [currentPage]="currentPage()"
              [totalPages]="totalPages()"
              (pageChange)="onPageChange($event)"
            ></app-pagination>
          }
        </div>
      }
    </app-card>

    <app-modal
      [(isOpen)]="detailOpen"
      title="Detalle de Reseña"
      size="lg"
      (closed)="onDetailClosed()"
    >
      @if (detailLoading()) {
        <div class="py-10 text-center text-sm text-gray-500">
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"
          ></div>
          Cargando detalle...
        </div>
      } @else if (detailError()) {
        <div class="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {{ detailError() }}
        </div>
      } @else if (selectedReview(); as review) {
        <div class="space-y-5">
          <div class="flex items-center gap-3">
            @if (review.products.image_url) {
              <img
                [src]="review.products.image_url"
                [alt]="review.products.name"
                class="h-12 w-12 rounded-lg object-cover"
              />
            } @else {
              <div
                class="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100"
              >
                <app-icon
                  name="package"
                  [size]="20"
                  class="text-gray-400"
                ></app-icon>
              </div>
            }
            <div class="min-w-0">
              <p class="truncate font-medium text-gray-900">
                {{ review.products.name || '-' }}
              </p>
              <p class="text-sm text-gray-500">
                {{ review.users.first_name }} {{ review.users.last_name }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <span class="text-lg tracking-wider text-yellow-500">
              {{ getStars(review.rating) }}
            </span>
            <span
              class="text-xs font-medium px-2.5 py-1 rounded-full"
              [class]="getStateBadgeClass(review.state)"
            >
              {{ getStateLabel(review.state) }}
            </span>
            @if (review.verified_purchase) {
              <span
                class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
              >
                Compra verificada
              </span>
            }
          </div>

          <div>
            @if (review.title) {
              <h4 class="mb-1 font-medium text-gray-900">
                {{ review.title }}
              </h4>
            }
            <p class="whitespace-pre-wrap text-sm text-gray-700">
              {{ review.comment }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span>{{ formatDate(review.created_at) }}</span>
            <span>{{ review.helpful_count }} votos útiles</span>
            <span [class.text-red-600]="review.report_count > 0">
              {{ review.report_count }} reportes
            </span>
          </div>

          <div class="flex flex-wrap gap-2">
            @if (review.state !== 'approved') {
              <button
                class="inline-flex items-center gap-1 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100"
                (click)="onApprove(review)"
              >
                <app-icon name="check" [size]="16"></app-icon>
                Aprobar
              </button>
            }
            @if (review.state !== 'rejected') {
              <button
                class="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                (click)="onReject(review)"
              >
                <app-icon name="x" [size]="16"></app-icon>
                Rechazar
              </button>
            }
            @if (review.state !== 'hidden') {
              <button
                class="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                (click)="onHide(review)"
              >
                <app-icon name="eye-off" [size]="16"></app-icon>
                Ocultar
              </button>
            }
            <button
              class="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              (click)="onDelete(review)"
            >
              <app-icon name="trash-2" [size]="16"></app-icon>
              Eliminar
            </button>
          </div>

          <div class="rounded-lg border border-gray-200 p-4">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-sm font-semibold text-gray-900">
                Reportes de clientes
              </p>
              <span class="text-xs text-gray-500">
                {{ review.review_reports?.length || 0 }}
              </span>
            </div>
            @if ((review.review_reports?.length || 0) > 0) {
              <div class="space-y-3">
                @for (report of review.review_reports || []; track report.id) {
                  <div class="rounded-lg bg-red-50 p-3 text-sm">
                    <p class="font-medium text-red-800">
                      {{ report.reason }}
                    </p>
                    <p class="mt-1 text-xs text-red-600">
                      {{ report.users?.first_name || 'Cliente' }}
                      {{ report.users?.last_name || '' }} ·
                      {{ formatDateTime(report.created_at) }}
                    </p>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-500">
                Esta reseña no tiene reportes.
              </p>
            }
          </div>

          <div class="rounded-lg border border-gray-200 p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <p class="text-sm font-semibold text-gray-900">
                Respuesta de la tienda
              </p>
              @if (review.review_responses && !responseEditing()) {
                <div class="flex gap-2">
                  <button
                    class="text-xs font-medium text-primary hover:underline"
                    (click)="startEditResponse(review)"
                  >
                    Editar
                  </button>
                  <button
                    class="text-xs font-medium text-red-600 hover:underline"
                    (click)="onDeleteResponse(review.id)"
                  >
                    Eliminar
                  </button>
                </div>
              }
            </div>

            @if (responseError()) {
              <p class="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {{ responseError() }}
              </p>
            }

            @if (review.review_responses && !responseEditing()) {
              <div class="rounded-lg bg-blue-50 p-4">
                <p class="whitespace-pre-wrap text-sm text-blue-900">
                  {{ review.review_responses.content }}
                </p>
                <p class="mt-2 text-xs text-blue-600">
                  {{ formatDateTime(review.review_responses.created_at) }}
                </p>
              </div>
            } @else {
              <textarea
                class="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-primary"
                rows="4"
                placeholder="Escribe una respuesta..."
                [ngModel]="responseContent()"
                (ngModelChange)="responseContent.set($event)"
              ></textarea>
              <div class="mt-3 flex justify-end gap-2">
                @if (responseEditing()) {
                  <button
                    class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                    (click)="cancelEditResponse()"
                  >
                    Cancelar
                  </button>
                }
                <button
                  class="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  [disabled]="!responseContent().trim() || responseSubmitting()"
                  (click)="submitResponse()"
                >
                  @if (responseSubmitting()) {
                    <app-icon
                      name="loader-2"
                      [size]="16"
                      [spin]="true"
                    ></app-icon>
                  } @else {
                    <app-icon name="save" [size]="16"></app-icon>
                  }
                  {{
                    responseEditing() ? 'Guardar respuesta' : 'Enviar respuesta'
                  }}
                </button>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="py-10 text-center text-sm text-gray-500">
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100"
          >
            <app-icon name="alert-circle" [size]="20" class="text-gray-400"></app-icon>
          </div>
          <p>No se encontró la reseña solicitada.</p>
          <p class="mt-1 text-xs text-gray-400">
            Es posible que haya sido eliminada o que el enlace haya expirado.
          </p>
        </div>
      }
    </app-modal>
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
export class ReviewsComponent {
  private reviewsService = inject(AdminReviewsService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // State signals
  reviews = signal<Review[]>([]);
  stats = signal<ReviewStats>({
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
    flagged_count: 0,
    average_rating: null,
  });
  loading = signal(false);
  totalItems = signal(0);
  totalPages = signal(0);
  currentPage = signal(1);
  detailOpen = signal(false);
  detailLoading = signal(false);
  detailError = signal<string | null>(null);
  selectedReview = signal<Review | null>(null);
  responseContent = signal('');
  responseEditing = signal(false);
  responseSubmitting = signal(false);
  responseError = signal<string | null>(null);
  listError = signal<string | null>(null);
  private routedReviewId = signal<number | null>(null);

  // Filters
  filters = signal<ReviewFilters>({ page: 1, limit: 10 });

  // Filter configs for OptionsDropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Pendiente', value: 'pending' },
        { label: 'Aprobada', value: 'approved' },
        { label: 'Rechazada', value: 'rejected' },
        { label: 'Oculta', value: 'hidden' },
        { label: 'Reportada', value: 'flagged' },
      ],
    },
    {
      key: 'rating',
      label: 'Calificación',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: '1 \u2605', value: '1' },
        { label: '2 \u2605', value: '2' },
        { label: '3 \u2605', value: '3' },
        { label: '4 \u2605', value: '4' },
        { label: '5 \u2605', value: '5' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  // Table columns
  columns: TableColumn[] = [
    {
      key: 'products',
      label: 'Producto',
      transform: (v: any) => v?.name || '-',
    },
    {
      key: 'users',
      label: 'Cliente',
      transform: (v: any) =>
        `${v?.first_name || ''} ${v?.last_name || ''}`.trim() || '-',
    },
    {
      key: 'rating',
      label: 'Calificación',
      // Guard de tipo: si v no es un entero entre 0 y 5, devolvemos '-'
      // en vez de tirar TypeError al hacer .repeat() con NaN o un
      // string. Un throw aqu\u00ed aborta el @for del template y deja la tabla
      // entera vac\u00eda sin error visible (ese era el bug de "lista vac\u00eda").
      transform: (v: any) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 5) return '-';
        return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n);
      },
    },
    {
      key: 'comment',
      label: 'Comentario',
      // Guard de tipo: si v no es string (p.ej. null/undefined, o un array
      // con .length num\u00e9rico), devolvemos string vac\u00edo. Antes hac\u00edamos
      // v?.length sin typeof-check, lo cual para un tipo no-string
      // terminaba en substring() \u2192 TypeError \u2192 tabla vac\u00eda.
      transform: (v: any) => {
        if (typeof v !== 'string') return '';
        return v.length > 50 ? v.substring(0, 50) + '...' : v;
      },
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pending: 'yellow',
          approved: 'green',
          rejected: 'red',
          hidden: 'gray',
          flagged: 'red',
        },
      },
      transform: (val: string) => this.getStateLabel(val),
    },
    {
      key: 'created_at',
      label: 'Fecha',
      transform: (v: any) => (v ? formatDateOnlyUTC(v) : ''),
    },
  ];

  // Card config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'products',
    titleTransform: (v: any) => v?.name || '-',
    subtitleKey: 'users',
    subtitleTransform: (v: any) =>
      `${v?.first_name || ''} ${v?.last_name || ''}`.trim() || '-',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#eab308',
        approved: '#22c55e',
        rejected: '#ef4444',
        hidden: '#9ca3af',
        flagged: '#ef4444',
      },
    },
    badgeTransform: (val: string) => this.getStateLabel(val),
    detailKeys: [
      {
        key: 'rating',
        label: 'Calificaci\u00f3n',
        transform: (v: any) => '\u2605'.repeat(v) + '\u2606'.repeat(5 - v),
      },
      {
        key: 'comment',
        label: 'Comentario',
      },
    ],
    footerKey: 'created_at',
    footerLabel: 'Fecha',
    footerStyle: 'prominent',
    footerTransform: (v: any) => (v ? formatDateOnlyUTC(v) : ''),
  };

  // Table actions
  actions: TableAction[] = [
    {
      label: 'Aprobar',
      icon: 'check',
      variant: 'success',
      show: (item: Review) => item.state !== 'approved',
      action: (item: Review) => this.onApprove(item),
    },
    {
      label: 'Rechazar',
      icon: 'x',
      variant: 'danger',
      show: (item: Review) => item.state !== 'rejected',
      action: (item: Review) => this.onReject(item),
    },
    {
      label: 'Ocultar',
      icon: 'eye-off',
      variant: 'muted',
      show: (item: Review) => item.state !== 'hidden',
      action: (item: Review) => this.onHide(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Review) => this.onDelete(item),
    },
  ];

  constructor() {
    this.watchRouteReviewId();
    this.loadStats();
    this.loadReviews();
  }

  loadStats(): void {
    this.reviewsService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.data || res);
        },
        error: (error) =>
          this.listError.set(
            translateCustomerError(
              error,
              'No se pudieron cargar las estadísticas de reseñas',
            ),
          ),
      });
  }

  loadReviews(): void {
    this.loading.set(true);
    this.listError.set(null);
    this.reviewsService
      .getAll(this.filters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Support both response shapes: { data: [...] } and
          // { data: { items: [...] } }. Some backends wrap the list
          // inside an items object for pagination metadata.
          const payload = res?.data;
          const items = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.items)
            ? payload.items
            : [];
          this.reviews.set(items);
          const meta = res?.meta ?? payload?.meta;
          if (meta) {
            this.totalItems.set(meta.total || 0);
            this.totalPages.set(meta.totalPages || meta.total_pages || 0,
            );
            this.currentPage.set(res.meta.page || 1);
          }
          this.loading.set(false);
        },
        error: (error) => {
          this.listError.set(
            translateCustomerError(error, 'No se pudieron cargar las reseñas'),
          );
          this.loading.set(false);
        },
      });
  }

  onSearch(search: string): void {
    this.filters.update((f) => ({ ...f, search, page: 1 }));
    this.loadReviews();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filters.update((f) => ({
      ...f,
      state: (values['state'] as any) || undefined,
      rating: values['rating'] ? Number(values['rating']) : undefined,
      page: 1,
    }));
    this.loadReviews();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadReviews();
  }

  onApprove(review: Review): void {
    this.reviewsService
      .approve(review.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadReviews();
          this.loadStats();
          this.closeDetail();
        },
        error: (error) =>
          this.listError.set(
            translateCustomerError(error, 'No se pudo aprobar la rese\u00f1a'),
          ),
      });
  }

  onReject(review: Review): void {
    this.reviewsService
      .reject(review.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadReviews();
          this.loadStats();
          this.closeDetail();
        },
        error: (error) =>
          this.listError.set(
            translateCustomerError(error, 'No se pudo rechazar la rese\u00f1a'),
          ),
      });
  }

  onHide(review: Review): void {
    this.reviewsService
      .hide(review.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadReviews();
          this.loadStats();
          this.closeDetail();
        },
        error: (error) =>
          this.listError.set(
            translateCustomerError(error, 'No se pudo ocultar la rese\u00f1a'),
          ),
      });
  }

  onDelete(review: Review): void {
    if (!confirm('\u00bfEst\u00e1s seguro de eliminar esta rese\u00f1a?'))
      return;
    this.reviewsService
      .delete(review.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadReviews();
          this.loadStats();
          this.closeDetail();
        },
        error: (error) =>
          this.listError.set(
            translateCustomerError(error, 'No se pudo eliminar la rese\u00f1a'),
          ),
      });
  }

  openDetail(review: Review): void {
    this.openDetailById(review.id, review);
  }

  private openDetailById(reviewId: number, seedReview?: Review): void {
    this.detailOpen.set(true);
    this.selectedReview.set(seedReview ?? null);
    this.responseContent.set('');
    this.responseEditing.set(false);
    this.responseError.set(null);
    this.detailError.set(null);
    this.detailLoading.set(true);

    this.reviewsService
      .getOne(reviewId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Support both response shapes: { data: {...} } and a flat
          // response object. Pick whichever has the review fields.
          const candidate = res?.data ?? res;
          this.selectedReview.set(candidate?.id ? candidate : null);
          this.detailLoading.set(false);
        },
        error: (error) => {
          this.detailError.set(
            translateCustomerError(
              error,
              'No se pudo cargar el detalle de la reseña',
            ),
          );
          this.detailLoading.set(false);
        },
      });
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.clearRoutedReviewId();
    this.clearDetailState();
  }

  onDetailClosed(): void {
    this.clearRoutedReviewId();
    this.clearDetailState();
  }

  private clearDetailState(): void {
    this.selectedReview.set(null);
    this.responseContent.set('');
    this.responseEditing.set(false);
    this.responseSubmitting.set(false);
    this.responseError.set(null);
    this.detailLoading.set(false);
    this.detailError.set(null);
  }

  submitResponse(): void {
    const review = this.selectedReview();
    if (!review || !this.responseContent().trim()) return;

    this.responseSubmitting.set(true);
    this.responseError.set(null);
    const request =
      this.responseEditing() && review.review_responses
        ? this.reviewsService.updateResponse(
            review.id,
            this.responseContent().trim(),
          )
        : this.reviewsService.createResponse(
            review.id,
            this.responseContent().trim(),
          );

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.responseSubmitting.set(false);
        this.responseEditing.set(false);
        this.responseContent.set('');
        this.reloadSelectedReview(review.id);
        this.loadReviews();
      },
      error: (error) => {
        this.responseSubmitting.set(false);
        this.responseError.set(
          translateCustomerError(error, 'No se pudo guardar la respuesta'),
        );
      },
    });
  }

  onDeleteResponse(reviewId: number): void {
    if (!confirm('\u00bfEliminar la respuesta?')) return;
    this.reviewsService
      .deleteResponse(reviewId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.responseEditing.set(false);
          this.responseContent.set('');
          this.reloadSelectedReview(reviewId);
          this.loadReviews();
        },
        error: (error) => {
          this.responseError.set(
            translateCustomerError(error, 'No se pudo eliminar la respuesta'),
          );
        },
      });
  }

  startEditResponse(review: Review): void {
    this.responseContent.set(review.review_responses?.content || '');
    this.responseEditing.set(true);
    this.responseError.set(null);
  }

  cancelEditResponse(): void {
    this.responseContent.set('');
    this.responseEditing.set(false);
    this.responseError.set(null);
  }

  private reloadSelectedReview(reviewId: number): void {
    this.reviewsService
      .getOne(reviewId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.selectedReview.set(res.data || res),
        error: (error) => {
          this.detailError.set(
            translateCustomerError(
              error,
              'No se pudo recargar el detalle de la reseña',
            ),
          );
        },
      });
  }

  private watchRouteReviewId(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const reviewId = this.parseReviewId(
          params.get('review_id') ?? params.get('reviewId'),
        );

        if (!reviewId) {
          this.routedReviewId.set(null);
          return;
        }

        if (this.routedReviewId() === reviewId && this.detailOpen()) return;

        this.routedReviewId.set(reviewId);
        this.openDetailById(
          reviewId,
          this.reviews().find((review) => review.id === reviewId),
        );
      });
  }

  private parseReviewId(value: string | null): number | null {
    const reviewId = Number(value);
    return Number.isInteger(reviewId) && reviewId > 0 ? reviewId : null;
  }

  private clearRoutedReviewId(): void {
    if (!this.routedReviewId()) return;

    this.routedReviewId.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { review_id: null, reviewId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  getStars(rating: number): string {
    return '\u2605'.repeat(rating) + '\u2606'.repeat(5 - rating);
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobada',
      rejected: 'Rechazada',
      hidden: 'Oculta',
      flagged: 'Reportada',
    };
    return labels[state] || state;
  }

  getStateBadgeClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      hidden: 'bg-gray-100 text-gray-800',
      flagged: 'bg-red-100 text-red-800',
    };
    return classes[state] || 'bg-gray-100 text-gray-800';
  }

  formatDate(value: string | Date | null | undefined): string {
    if (!value) return '';
    try {
      return formatDateOnlyUTC(value);
    } catch {
      return String(value);
    }
  }

  formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }
}
