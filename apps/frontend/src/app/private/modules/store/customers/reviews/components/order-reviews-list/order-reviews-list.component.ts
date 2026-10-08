import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { AdminReviewsService } from '../../services/reviews.service';
import {
  AdminOrderReview,
  ORDER_REVIEW_QUICK_TAG_LABELS,
  ORDER_REVIEW_SOURCE_LABELS,
  OrderReviewFilters,
  OrderReviewQuickTag,
} from '../../models/review.model';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { PaginationComponent } from '../../../../../../../shared/components/pagination/pagination.component';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDateTime } from '../../../../../../../shared/utils/date.util';

const stars = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 5) return '-';
  return '★'.repeat(n) + '☆'.repeat(5 - n);
};

@Component({
  selector: 'app-order-reviews-list',
  standalone: true,
  imports: [
    CardComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
  ],
  template: `
    <app-card [responsive]="true" [padding]="false">
      <div
        class="px-2 py-1.5 md:px-6 md:py-4 md:border-b md:border-border flex items-center justify-between gap-2"
      >
        <h2
          class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
        >
          Experiencias de compra ({{ totalItems() }})
        </h2>
        <app-options-dropdown
          class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
          [filters]="filterConfigs"
          [filterValues]="filterValues()"
          (filterChange)="onFilterChange($event)"
        ></app-options-dropdown>
      </div>

      @if (listError()) {
        <div class="mx-2 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 md:mx-4">
          {{ listError() }}
        </div>
      }

      <div class="px-2 pb-2 pt-3 md:p-4">
        <app-responsive-data-view
          [data]="reviews()"
          [columns]="columns()"
          [cardConfig]="cardConfig()"
          [actions]="actions"
          [loading]="loading()"
          emptyMessage="Aún no hay experiencias de compra"
          emptyIcon="star"
          (rowClick)="openOrder($event)"
        ></app-responsive-data-view>
        <app-pagination
          [currentPage]="currentPage()"
          [totalPages]="totalPages()"
          (pageChange)="onPageChange($event)"
        ></app-pagination>
      </div>
    </app-card>
  `,
  styles: [`:host { display: block; width: 100%; }`],
})
export class OrderReviewsListComponent {
  private reviewsService = inject(AdminReviewsService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private settingsFacade = inject(StoreSettingsFacade);

  readonly reviews = signal<AdminOrderReview[]>([]);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly totalItems = signal(0);
  readonly totalPages = signal(0);
  readonly currentPage = signal(1);
  readonly filters = signal<OrderReviewFilters>({ page: 1, limit: 10 });
  readonly filterValues = signal<FilterValues>({});

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'rating',
      label: 'Calificación',
      type: 'select',
      placeholder: 'Todas',
      options: [1, 2, 3, 4, 5].map((n) => ({ label: `${n} ★`, value: String(n) })),
    },
    {
      key: 'quick_tag',
      label: 'Etiqueta',
      type: 'select',
      placeholder: 'Todas',
      options: (
        Object.keys(ORDER_REVIEW_QUICK_TAG_LABELS) as OrderReviewQuickTag[]
      ).map((k) => ({ label: ORDER_REVIEW_QUICK_TAG_LABELS[k], value: k })),
    },
    {
      key: 'date',
      label: 'Fecha',
      type: 'date-range',
      startKey: 'date_from',
      endKey: 'date_to',
    },
  ];

  private formatDate(value: string): string {
    return formatStoreDateTime(value, this.settingsFacade.timezone());
  }

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'created_at', label: 'Fecha', transform: (v: string) => this.formatDate(v) },
    { key: 'order_number', label: 'Orden', transform: (v: string) => (v ? `#${v}` : '-') },
    { key: 'customer_name', label: 'Cliente', transform: (v: string | null) => v || '-' },
    { key: 'rating', label: 'Calificación', transform: stars },
    {
      key: 'quick_tag',
      label: 'Etiqueta',
      transform: (v: OrderReviewQuickTag | null) =>
        v ? ORDER_REVIEW_QUICK_TAG_LABELS[v] : '-',
    },
    {
      key: 'comment',
      label: 'Comentario',
      transform: (v: unknown) => {
        if (typeof v !== 'string' || !v) return '-';
        return v.length > 60 ? v.substring(0, 60) + '...' : v;
      },
    },
  ]);

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'order_number',
    titleTransform: (item: AdminOrderReview) => `#${item.order_number}`,
    subtitleKey: 'customer_name',
    subtitleTransform: (item: AdminOrderReview) => item.customer_name || '-',
    badgeKey: 'rating',
    badgeTransform: (v: unknown) => stars(v),
    detailKeys: [
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (v: string) => this.formatDate(v),
      },
      {
        key: 'quick_tag',
        label: 'Etiqueta',
        icon: 'tag',
        transform: (v: OrderReviewQuickTag | null) =>
          v ? ORDER_REVIEW_QUICK_TAG_LABELS[v] : '-',
      },
      {
        key: 'source',
        label: 'Origen',
        icon: 'info',
        transform: (v: keyof typeof ORDER_REVIEW_SOURCE_LABELS) =>
          ORDER_REVIEW_SOURCE_LABELS[v] ?? '-',
      },
    ],
  }));

  readonly actions: TableAction[] = [
    {
      label: 'Ver orden',
      icon: 'eye',
      action: (item: AdminOrderReview) => this.openOrder(item),
      variant: 'primary',
    },
  ];

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.listError.set(null);
    this.reviewsService
      .getOrderReviews(this.filters())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = Array.isArray(res?.data) ? res.data : [];
          this.reviews.set(data);
          const meta = res?.meta;
          this.totalItems.set(meta?.total ?? data.length);
          this.totalPages.set(meta?.totalPages ?? meta?.total_pages ?? 0);
          this.currentPage.set(meta?.page ?? this.filters().page ?? 1);
          this.loading.set(false);
        },
        error: () => {
          this.reviews.set([]);
          this.listError.set('No se pudieron cargar las experiencias de compra.');
          this.loading.set(false);
        },
      });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.filters.update((f) => ({
      ...f,
      rating: values['rating'] ? Number(values['rating']) : undefined,
      quick_tag: (values['quick_tag'] as OrderReviewQuickTag) || undefined,
      date_from: (values['date_from'] as string) || undefined,
      date_to: (values['date_to'] as string) || undefined,
      page: 1,
    }));
    this.load();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.load();
  }

  openOrder(item: AdminOrderReview): void {
    this.router.navigate(['/admin/orders', item.order_id]);
  }
}
