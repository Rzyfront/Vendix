import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';

import {
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../../shared/components/index';
import {
  ShippingRate,
  ZoneWithRates,
} from '../../interfaces/shipping-zones.interface';

@Component({
  selector: 'app-method-zones-inline',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ResponsiveDataViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zones-inline">
      <!-- Header compacto: título + botón -->
      <div class="zones-inline__header-row">
        <span class="zones-inline__title">Zonas y Tarifas</span>
        @if (!is_loading()) {
          <app-button variant="outline" size="sm" (clicked)="addRate.emit()">
            <app-icon slot="icon" name="plus" [size]="14" />
            Agregar Tarifa
          </app-button>
        }
      </div>

      <app-responsive-data-view
        [data]="tableData"
        [columns]="columns"
        [cardConfig]="cardConfig"
        [actions]="tableActions"
        [loading]="is_loading()"
        [tableSize]="'sm'"
        [itemListSize]="'sm'"
        [hoverable]="true"
        [striped]="true"
        emptyMessage="Sin tarifas configuradas"
        emptyIcon="tag"
        [showEmptyAction]="true"
        emptyActionText="Agregar Tarifa"
        emptyActionIcon="plus"
        (rowClick)="onRowClick($event)"
        (emptyActionClick)="addRate.emit()"
      />
    </div>
  `,
  styles: [`
    :host { display: block; }

    .zones-inline {
      padding: 0 0.5rem 0.75rem;

      @media (min-width: 768px) {
        padding: 0 1rem 1rem;
      }
    }

    .zones-inline__header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0 0.75rem;
    }

    .zones-inline__title {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `],
})
export class MethodZonesInlineComponent {
  // Inputs
  readonly zones = input.required<ZoneWithRates[]>();
  readonly is_loading = input<boolean>(false);

  // Outputs
  readonly addRate = output<void>();
  readonly editRate = output<ShippingRate>();
  readonly deleteRate = output<ShippingRate>();

  // ─── Mapped data for table ───

  get tableData(): any[] {
    return this.zones().map((item) => ({
      id: item.rate.id,
      zone_name: item.zone.name,
      rate_type_label: this.getRateTypeLabel(item.rate.type),
      base_cost: this.formatCost(item.rate),
      free_shipping: item.rate.free_shipping_threshold
        ? `$${Number(item.rate.free_shipping_threshold).toLocaleString('es-CO')}`
        : '—',
      status: item.rate.is_active ? 'active' : 'inactive',
      _rate: item.rate,
    }));
  }

  // ─── Table columns (desktop) ───

  columns: TableColumn[] = [
    { key: 'zone_name', label: 'Zona', priority: 1 },
    { key: 'rate_type_label', label: 'Tipo', priority: 2 },
    { key: 'base_cost', label: 'Costo Base', priority: 3 },
    { key: 'free_shipping', label: 'Envío Gratis desde', priority: 4 },
    { key: 'status', label: 'Estado', badge: true, badgeConfig: { type: 'status' }, priority: 5 },
  ];

  // ─── Card config (mobile) ───

  cardConfig: ItemListCardConfig = {
    titleKey: 'zone_name',
    subtitleKey: 'rate_type_label',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    footerKey: 'base_cost',
    footerLabel: 'Costo',
    footerStyle: 'prominent',
    detailKeys: [
      { key: 'free_shipping', label: 'Envío gratis desde', icon: 'tag' },
    ],
  };

  // ─── Shared actions ───

  get tableActions(): TableAction[] {
    return [
      {
        label: 'Editar',
        icon: 'pencil',
        variant: 'info',
        action: (item: any) => this.editRate.emit(item._rate),
      },
      {
        label: 'Eliminar',
        icon: 'trash-2',
        variant: 'danger',
        action: (item: any) => this.deleteRate.emit(item._rate),
      },
    ];
  }

  // ─── Row click ───

  onRowClick(item: any): void {
    if (item._rate) {
      this.editRate.emit(item._rate);
    }
  }

  // ─── Helpers ───

  private getRateTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      flat: 'Tarifa plana',
      weight_based: 'Por peso',
      price_based: 'Por precio',
      carrier_calculated: 'Calculado',
      free: 'Gratis',
    };
    return labels[type] || type;
  }

  private formatCost(rate: ShippingRate): string {
    if (rate.type === 'free') return '$0';
    let cost = `$${Number(rate.base_cost).toLocaleString('es-CO')}`;
    if (rate.per_unit_cost && (rate.type === 'weight_based' || rate.type === 'price_based')) {
      const unit = rate.type === 'weight_based' ? 'kg' : '$';
      cost += ` + $${Number(rate.per_unit_cost).toLocaleString('es-CO')}/${unit}`;
    }
    return cost;
  }
}
