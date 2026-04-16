import { Component, DestroyRef, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { signal } from '@angular/core';

import {
  StatsComponent,
  DialogService,
  ToastService,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

import { PromotionsActions } from './state/actions/promotions.actions';
import {
  selectPromotions,
  selectPromotionsLoading,
  selectPromotionsMeta,
  selectSummary,
  selectSummaryLoading,
  selectError,
} from './state/selectors/promotions.selectors';
import {
  Promotion,
  CreatePromotionDto,
  UpdatePromotionDto,
} from './interfaces/promotion.interface';
import { PromotionListComponent } from './components/promotion-list/promotion-list.component';
import { PromotionFormModalComponent } from './components/promotion-form-modal/promotion-form-modal.component';
import { PromotionsService } from './services/promotions.service';

@Component({
  selector: 'app-promotions',
  standalone: true,
  imports: [
    StatsComponent,
    PromotionListComponent,
    PromotionFormModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Activas"
          [value]="summary()?.total_active ?? 0"
          smallText="Promociones activas"
          iconName="zap"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="summaryLoading()"
        ></app-stats>

        <app-stats
          title="Programadas"
          [value]="summary()?.total_scheduled ?? 0"
          smallText="Por activarse"
          iconName="clock"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="summaryLoading()"
        ></app-stats>

        <app-stats
          title="Total descuentos"
          [value]="formatCurrency(summary()?.total_discount_given ?? 0)"
          smallText="Descuento otorgado"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="summaryLoading()"
        ></app-stats>

        <app-stats
          title="Usos totales"
          [value]="summary()?.total_usage ?? 0"
          smallText="Veces aplicadas"
          iconName="bar-chart-3"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="summaryLoading()"
        ></app-stats>
      </div>

      <!-- List -->
      <app-promotion-list
        [promotions]="promotions()"
        [loading]="loading()"
        [meta]="meta()"
        (create)="openCreateModal()"
        (edit)="openEditModal($event)"
        (activate)="onActivate($event)"
        (pause)="onPause($event)"
        (cancel)="onCancel($event)"
        (delete)="onDelete($event)"
        (pageChange)="onPageChange($event)"
        (searchChange)="onSearchChange($event)"
        (filterChange)="onFilterChange($event)"
      ></app-promotion-list>

      <!-- Create/Edit Modal -->
      @if (show_form_modal()) {
        <app-promotion-form-modal
          [promotion]="selected_promotion()"
          (save)="onSave($event)"
          (close)="closeFormModal()"
        />
      }
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
export class PromotionsComponent {
  private store = inject(Store);
  private promotions_service = inject(PromotionsService);
  private currency_service = inject(CurrencyFormatService);
  private dialog_service = inject(DialogService);
  private toast_service = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  // State via toSignal
  protected promotions = toSignal(this.store.select(selectPromotions), { initialValue: [] as Promotion[] });
  protected loading = toSignal(this.store.select(selectPromotionsLoading), { initialValue: false });
  protected meta = toSignal(this.store.select(selectPromotionsMeta), { initialValue: null });
  protected summary = toSignal(this.store.select(selectSummary), { initialValue: null });
  protected summaryLoading = toSignal(this.store.select(selectSummaryLoading), { initialValue: false });

  // Modal
  protected show_form_modal = signal(false);
  protected selected_promotion = signal<Promotion | null>(null);

  constructor() {
    this.store.dispatch(PromotionsActions.loadPromotions());
    this.store.dispatch(PromotionsActions.loadSummary());

    this.store
      .select(selectError)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((error) => {
        if (error) {
          this.toast_service.error(error);
        }
      });
  }

  protected formatCurrency(value: number): string {
    return this.currency_service.format(value);
  }

  // ── Modal ──────────────────────────────────────────────────────────────

  protected openCreateModal(): void {
    this.selected_promotion.set(null);
    this.show_form_modal.set(true);
  }

  protected openEditModal(promotion: Promotion): void {
    this.promotions_service.getPromotion(promotion.id).subscribe({
      next: (res) => {
        this.selected_promotion.set(res.data);
        this.show_form_modal.set(true);
      },
    });
  }

  protected closeFormModal(): void {
    this.show_form_modal.set(false);
    this.selected_promotion.set(null);
  }

  protected onSave(dto: CreatePromotionDto | UpdatePromotionDto): void {
    const current = this.selected_promotion();
    if (current) {
      this.store.dispatch(
        PromotionsActions.updatePromotion({
          id: current.id,
          dto: dto as UpdatePromotionDto,
        }),
      );
    } else {
      this.store.dispatch(
        PromotionsActions.createPromotion({ dto: dto as CreatePromotionDto }),
      );
    }
    this.closeFormModal();
  }

  // ── Actions ────────────────────────────────────────────────────────────

  protected onActivate(id: number): void {
    this.store.dispatch(PromotionsActions.activatePromotion({ id }));
  }

  protected onPause(id: number): void {
    this.store.dispatch(PromotionsActions.pausePromotion({ id }));
  }

  protected onCancel(id: number): void {
    this.dialog_service
      .confirm({
        title: 'Cancelar promocion',
        message: '¿Estas seguro de cancelar esta promocion? Esta accion no se puede deshacer.',
        confirmText: 'Si, cancelar',
        cancelText: 'No',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.store.dispatch(PromotionsActions.cancelPromotion({ id }));
        }
      });
  }

  protected onDelete(id: number): void {
    this.dialog_service
      .confirm({
        title: 'Eliminar promocion',
        message: '¿Estas seguro de eliminar esta promocion?',
        confirmText: 'Si, eliminar',
        cancelText: 'No',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.store.dispatch(PromotionsActions.deletePromotion({ id }));
        }
      });
  }

  // ── Filters ────────────────────────────────────────────────────────────

  protected onPageChange(page: number): void {
    this.store.dispatch(PromotionsActions.setPage({ page }));
  }

  protected onSearchChange(search: string): void {
    this.store.dispatch(PromotionsActions.setSearch({ search }));
  }

  protected onFilterChange(filters: Record<string, string>): void {
    if (filters['state'] !== undefined) {
      this.store.dispatch(
        PromotionsActions.setStateFilter({ state: filters['state'] }),
      );
    }
    if (filters['type'] !== undefined) {
      this.store.dispatch(
        PromotionsActions.setTypeFilter({
          promotion_type: filters['type'],
        }),
      );
    }
    if (filters['scope'] !== undefined) {
      this.store.dispatch(
        PromotionsActions.setScopeFilter({ scope: filters['scope'] }),
      );
    }
  }
}
