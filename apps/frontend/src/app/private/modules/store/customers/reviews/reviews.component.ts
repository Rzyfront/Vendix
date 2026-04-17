import { Component, inject, signal, DestroyRef } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

@Component({
  selector: 'app-reviews',
  standalone: true,
  imports: [
    DecimalPipe,
    DatePipe,
    FormsModule,
    StatsComponent,
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    IconComponent,
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
          title="Rating Promedio"
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

      <!-- Data + Pagination -->
      @if (!loading()) {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view
            [data]="reviews()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [actions]="actions"
            [loading]="loading()"
            emptyMessage="No hay reseñas registradas"
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

    <!-- Detail overlay -->
    @if (selectedReview()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        (click)="closeDetail()"
      >
        <div
          class="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              Detalle de Reseña
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600 transition-colors"
              (click)="closeDetail()"
            >
              <app-icon name="x" [size]="20"></app-icon>
            </button>
          </div>

          <!-- Product info -->
          <div class="flex items-center gap-3 mb-4">
            @if (selectedReview()!.products.image_url) {
              <img
                [src]="selectedReview()!.products.image_url"
                [alt]="selectedReview()!.products.name"
                class="w-12 h-12 rounded-lg object-cover"
              />
            } @else {
              <div
                class="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center"
              >
                <app-icon
                  name="package"
                  [size]="20"
                  class="text-gray-400"
                ></app-icon>
              </div>
            }
            <div>
              <p class="font-medium text-gray-900">
                {{ selectedReview()!.products.name || '-' }}
              </p>
              <p class="text-sm text-gray-500">
                {{ selectedReview()!.users.first_name }}
                {{ selectedReview()!.users.last_name }}
              </p>
            </div>
          </div>

          <!-- Rating -->
          <div class="mb-3">
            <span class="text-yellow-500 text-lg tracking-wider">
              {{ getStars(selectedReview()!.rating) }}
            </span>
            @if (selectedReview()!.verified_purchase) {
              <span
                class="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full"
              >
                Compra verificada
              </span>
            }
          </div>

          <!-- Title & Comment -->
          @if (selectedReview()!.title) {
            <h4 class="font-medium text-gray-900 mb-1">
              {{ selectedReview()!.title }}
            </h4>
          }
          <p class="text-gray-700 text-sm mb-4 whitespace-pre-wrap">
            {{ selectedReview()!.comment }}
          </p>

          <!-- Meta -->
          <div class="flex items-center gap-4 text-xs text-gray-500 mb-4">
            <span>{{ selectedReview()!.created_at | date: 'dd/MM/yyyy' }}</span>
            <span>👍 {{ selectedReview()!.helpful_count }}</span>
            @if (selectedReview()!.report_count > 0) {
              <span class="text-red-500"
                >⚠ {{ selectedReview()!.report_count }} reportes</span
              >
            }
          </div>

          <!-- State badge -->
          <div class="mb-4">
            <span
              class="text-xs font-medium px-2.5 py-1 rounded-full"
              [class]="getStateBadgeClass(selectedReview()!.state)"
            >
              {{ getStateLabel(selectedReview()!.state) }}
            </span>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 mb-6">
            @if (selectedReview()!.state !== 'approved') {
              <button
                class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                (click)="onApprove(selectedReview()!)"
              >
                Aprobar
              </button>
            }
            @if (selectedReview()!.state !== 'rejected') {
              <button
                class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                (click)="onReject(selectedReview()!)"
              >
                Rechazar
              </button>
            }
            <button
              class="px-3 py-2 text-sm font-medium rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
              (click)="onDelete(selectedReview()!)"
            >
              Eliminar
            </button>
          </div>

          <!-- Existing response -->
          @if (selectedReview()!.review_responses) {
            <div class="bg-blue-50 rounded-lg p-4 mb-4">
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-medium text-blue-800">
                  Respuesta de la tienda
                </p>
                <button
                  class="text-xs text-red-500 hover:text-red-700"
                  (click)="onDeleteResponse(selectedReview()!.id)"
                >
                  Eliminar respuesta
                </button>
              </div>
              <p class="text-sm text-blue-900 whitespace-pre-wrap">
                {{ selectedReview()!.review_responses!.content }}
              </p>
              <p class="text-xs text-blue-600 mt-2">
                {{
                  selectedReview()!.review_responses!.created_at
                    | date: 'dd/MM/yyyy HH:mm'
                }}
              </p>
            </div>
          }

          <!-- Response form -->
          @if (!selectedReview()!.review_responses) {
            <div class="border-t pt-4">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >Responder a esta reseña</label
              >
              <textarea
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
                rows="3"
                placeholder="Escribe una respuesta..."
                [ngModel]="responseContent()"
                (ngModelChange)="responseContent.set($event)"
              ></textarea>
              <button
                class="mt-2 w-full px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                [disabled]="!responseContent().trim()"
                (click)="submitResponse()"
              >
                Enviar Respuesta
              </button>
            </div>
          }
        </div>
      </div>
    }
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
  selectedReview = signal<Review | null>(null);
  responseContent = signal('');

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
      label: 'Rating',
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
      label: 'Rating',
      transform: (v: any) => '\u2605'.repeat(v) + '\u2606'.repeat(5 - v),
    },
    {
      key: 'comment',
      label: 'Comentario',
      transform: (v: any) => (v?.length > 50 ? v.substring(0, 50) + '...' : v),
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
      transform: (v: any) =>
        new Date(v).toLocaleDateString('es', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
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
        label: 'Rating',
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
    footerTransform: (v: any) =>
      new Date(v).toLocaleDateString('es', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
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
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Review) => this.onDelete(item),
    },
  ];

  constructor() {
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
        error: (err) => console.error('Error loading review stats:', err),
      });
  }

  loadReviews(): void {
    this.loading.set(true);
    this.reviewsService
      .getAll(this.filters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.reviews.set(res.data || []);
          if (res.meta) {
            this.totalItems.set(res.meta.total || 0);
            this.totalPages.set(
              res.meta.totalPages || res.meta.total_pages || 0,
            );
            this.currentPage.set(res.meta.page || 1);
          }
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Error loading reviews:', err);
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
        error: (err) => console.error('Error approving review:', err),
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
        error: (err) => console.error('Error rejecting review:', err),
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
        error: (err) => console.error('Error deleting review:', err),
      });
  }

  openDetail(review: Review): void {
    this.selectedReview.set(review);
    this.responseContent.set('');
  }

  closeDetail(): void {
    this.selectedReview.set(null);
    this.responseContent.set('');
  }

  submitResponse(): void {
    const review = this.selectedReview();
    if (!review || !this.responseContent().trim()) return;

    this.reviewsService
      .createResponse(review.id, this.responseContent().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Reload the detail
          this.reviewsService
            .getOne(review.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (res) => {
                this.selectedReview.set(res.data || res);
                this.responseContent.set('');
              },
            });
          this.loadReviews();
        },
        error: (err) => console.error('Error creating response:', err),
      });
  }

  onDeleteResponse(reviewId: number): void {
    if (!confirm('\u00bfEliminar la respuesta?')) return;
    this.reviewsService
      .deleteResponse(reviewId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.reviewsService
            .getOne(reviewId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (res) => this.selectedReview.set(res.data || res),
            });
        },
        error: (err) => console.error('Error deleting response:', err),
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
}
