import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../../shared/components/inputsearch/inputsearch.component';
import { ResponsiveDataViewComponent } from '../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import {
  TableColumn,
  TableAction,
} from '../../../../../shared/components/table/table.component';
import { ItemListCardConfig } from '../../../../../shared/components/item-list/item-list.interfaces';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { CouponModalComponent } from './components/coupon-modal/coupon-modal.component';
import * as CouponActions from './state/actions/coupon.actions';
import {
  selectCoupons,
  selectCouponsLoading,
  selectStats,
} from './state/selectors/coupon.selectors';
import {
  Coupon,
  CouponStats,
  CreateCouponRequest,
} from './interfaces/coupon.interface';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-coupons',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    CouponModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats Cards -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Cupones"
          [value]="stats()?.total_coupons ?? 0"
          smallText="Cupones creados"
          iconName="ticket"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activos"
          [value]="stats()?.active_coupons ?? 0"
          smallText="Disponibles para uso"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Usos Totales"
          [value]="stats()?.total_uses ?? 0"
          smallText="Cupones canjeados"
          iconName="bar-chart-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
        <app-stats
          title="Descuento Aplicado"
          [value]="formatCurrency(stats()?.total_discount_applied ?? 0)"
          smallText="Descuento total otorgado"
          iconName="dollar-sign"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Data Table -->
      <app-card [responsive]="true" [padding]="false">
        <!-- Search Section (inside card) -->
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
              Cupones ({{ coupons().length }})
            </h2>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                placeholder="Buscar cupón..."
                [debounceTime]="300"
                (searchChange)="onSearch($event)"
              />
              <app-button
                variant="outline"
                size="sm"
                customClasses="w-9 h-9 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                (clicked)="openCreateModal()"
                title="Crear Cupón"
              >
                <app-icon slot="icon" name="plus" [size]="18"></app-icon>
              </app-button>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        @if (loading()) {
          <div class="p-4 md:p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando cupones...</p>
          </div>
        }

        <!-- Data View -->
        @if (!loading()) {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="coupons()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              emptyMessage="No hay cupones creados"
              emptyIcon="ticket"
            />
          </div>
        }
      </app-card>
    </div>

    <!-- Modal -->
    <app-coupon-modal
      [visible]="showModal()"
      [coupon]="editingCoupon()"
      [loading]="loading()"
      (close)="closeModal()"
      (save)="onSave($event)"
    />
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
export class CouponsComponent implements OnInit {
  private store = inject(Store);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);

  coupons = this.store.selectSignal(selectCoupons);
  loading = this.store.selectSignal(selectCouponsLoading);
  stats = this.store.selectSignal(selectStats);

  showModal = signal(false);
  editingCoupon = signal<Coupon | null>(null);

  columns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true },
    { key: 'name', label: 'Nombre', sortable: true },
    {
      key: 'discount_type',
      label: 'Tipo',
      transform: (_val: any, row: any) =>
        row.discount_type === 'PERCENTAGE' ? 'Porcentaje' : 'Monto Fijo',
    },
    {
      key: 'discount_value',
      label: 'Valor',
      transform: (_val: any, row: any) =>
        row.discount_type === 'PERCENTAGE'
          ? `${Number(row.discount_value)}%`
          : this.currencyService.format(Number(row.discount_value) || 0),
    },
    {
      key: 'current_uses',
      label: 'Usos',
      transform: (_val: any, row: any) =>
        `${row.current_uses}${row.max_uses ? '/' + row.max_uses : ''}`,
    },
    {
      key: 'valid_until',
      label: 'Válido hasta',
      transform: (val: any) => new Date(val).toLocaleDateString('es-CO'),
    },
    {
      key: 'is_active',
      label: 'Estado',
      transform: (val: any) => (val ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { Activo: 'green', Inactivo: 'gray' },
      },
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        Activo: '#22c55e',
        Inactivo: '#9ca3af',
      },
    },
    badgeTransform: (val: any) => (val ? 'Activo' : 'Inactivo'),
    footerKey: 'discount_value',
    footerLabel: 'Descuento',
    footerStyle: 'prominent',
    footerTransform: (_val: any, item: any) =>
      item.discount_type === 'PERCENTAGE'
        ? `${Number(item.discount_value)}%`
        : this.currencyService.format(Number(item.discount_value) || 0),
    detailKeys: [
      {
        key: 'discount_type',
        label: 'Tipo',
        transform: (val: any) =>
          val === 'PERCENTAGE' ? 'Porcentaje' : 'Monto Fijo',
      },
      {
        key: 'current_uses',
        label: 'Usos',
        transform: (val: any, item: any) =>
          `${item.current_uses}${item.max_uses ? '/' + item.max_uses : ''}`,
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (item: Coupon) => this.openEditModal(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Coupon) => this.onDelete(item),
    },
  ];

  ngOnInit() {
    this.store.dispatch(CouponActions.loadCoupons());
    this.store.dispatch(CouponActions.loadStats());
  }

  onSearch(search: string) {
    this.store.dispatch(CouponActions.setSearch({ search }));
  }

  openCreateModal() {
    this.editingCoupon.set(null);
    this.showModal.set(true);
  }

  openEditModal(coupon: Coupon) {
    this.editingCoupon.set(coupon);
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingCoupon.set(null);
  }

  onSave(request: CreateCouponRequest) {
    const editing = this.editingCoupon();
    if (editing) {
      this.store.dispatch(
        CouponActions.updateCoupon({ id: editing.id, coupon: request }),
      );
    } else {
      this.store.dispatch(CouponActions.createCoupon({ coupon: request }));
    }
    this.closeModal();
  }

  onDelete(coupon: Coupon) {
    this.dialogService
      .confirm({
        title: 'Eliminar Cupón',
        message: `¿Está seguro de que desea eliminar el cupón "${coupon.code}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.store.dispatch(CouponActions.deleteCoupon({ id: coupon.id }));
        }
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
