import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { TimelineComponent } from '../../../../../../shared/components/timeline/timeline.component';
import { TimelineStep } from '../../../../../../shared/components/timeline/timeline.interfaces';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNote, DispatchNoteStatus } from '../../interfaces/dispatch-note.interface';

const STATUS_LABELS: Record<DispatchNoteStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  delivered: 'Entregada',
  invoiced: 'Facturada',
  voided: 'Anulada',
};

const BADGE_COLOR_MAP: Record<DispatchNoteStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  confirmed: 'blue',
  delivered: 'green',
  invoiced: 'blue',
  voided: 'red',
};

@Component({
  selector: 'app-dispatch-note-detail',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    TimelineComponent,
    ResponsiveDataViewComponent,
    IconComponent,
  ],
  templateUrl: './dispatch-note-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DispatchNoteDetailComponent {
  private currencyService = inject(CurrencyFormatService);

  // ── Inputs ──────────────────────────────────────────
  readonly dispatch_note = input.required<DispatchNote>();

  // ── Outputs ─────────────────────────────────────────
  readonly confirmAction = output<DispatchNote>();
  readonly deliverAction = output<DispatchNote>();
  readonly voidAction = output<DispatchNote>();
  readonly invoiceAction = output<DispatchNote>();
  readonly printAction = output<DispatchNote>();

  // ── StickyHeader computed ───────────────────────────
  readonly headerTitle = computed(() => `Remision ${this.dispatch_note().dispatch_number}`);
  readonly headerSubtitle = computed(() => `Creada el ${this.formatDate(this.dispatch_note().created_at)}`);
  readonly headerBadgeText = computed(() => STATUS_LABELS[this.dispatch_note().status] || this.dispatch_note().status);
  readonly headerBadgeColor = computed<StickyHeaderBadgeColor>(() => BADGE_COLOR_MAP[this.dispatch_note().status] || 'gray');

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const status = this.dispatch_note().status;
    return [
      { id: 'confirm', label: 'Confirmar', variant: 'primary', icon: 'check', visible: status === 'draft' },
      { id: 'deliver', label: 'Entregar', variant: 'primary', icon: 'truck', visible: status === 'confirmed' },
      { id: 'invoice', label: 'Facturar', variant: 'primary', icon: 'file-plus', visible: status === 'delivered' },
      { id: 'print', label: 'Imprimir', variant: 'outline', icon: 'printer', visible: ['delivered', 'invoiced'].includes(status) },
      { id: 'void', label: 'Anular', variant: 'outline-danger', icon: 'x-circle', visible: status === 'confirmed' },
    ];
  });

  // ── Stats computed ──────────────────────────────────
  readonly statsIconColors = computed(() => {
    const color = BADGE_COLOR_MAP[this.dispatch_note().status];
    const map: Record<string, { bg: string; text: string }> = {
      gray: { bg: 'bg-gray-100', text: 'text-gray-500' },
      blue: { bg: 'bg-blue-100', text: 'text-blue-500' },
      green: { bg: 'bg-emerald-100', text: 'text-emerald-500' },
      red: { bg: 'bg-red-100', text: 'text-red-500' },
    };
    return map[color] || map['gray'];
  });

  // ── Items for ResponsiveDataView ────────────────────
  readonly computedItems = computed(() => {
    const items = this.dispatch_note().dispatch_note_items || [];
    return items.map((item, i) => ({ ...item, _index: i + 1 }));
  });

  readonly columns: TableColumn[] = [
    { key: '_index', label: '#', width: '50px', align: 'center' },
    {
      key: 'product.name',
      label: 'Producto',
      transform: (val: any, item: any) => item?.product?.name || item?.product?.product_name || `Producto #${item?.product_id}`,
    },
    { key: 'ordered_quantity', label: 'Pedida', align: 'center', width: '90px' },
    { key: 'dispatched_quantity', label: 'Despachada', align: 'center', width: '100px' },
    {
      key: 'unit_price',
      label: 'Precio Unit.',
      align: 'right',
      width: '120px',
      transform: (v: any) => v != null ? this.formatCurrency(v) : '-',
    },
    {
      key: 'total_price',
      label: 'Total',
      align: 'right',
      width: '120px',
      transform: (v: any) => v != null ? this.formatCurrency(v) : '-',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product.name',
    titleTransform: (item: any) => item.product?.name || item.product?.product_name || `Producto #${item.product_id}`,
    subtitleKey: 'product_variant.sku',
    subtitleTransform: (item: any) => {
      const parts: string[] = [];
      if (item.product_variant?.sku) parts.push(`SKU: ${item.product_variant.sku}`);
      if (item.lot_serial) parts.push(`Lote: ${item.lot_serial}`);
      return parts.join(' · ');
    },
    avatarFallbackIcon: 'package',
    avatarShape: 'square',
    detailKeys: [
      { key: 'ordered_quantity', label: 'Pedida' },
      { key: 'dispatched_quantity', label: 'Despachada' },
    ],
    footerKey: 'total_price',
    footerLabel: 'Total',
    footerTransform: (v: any) => v != null ? this.formatCurrency(v) : '-',
    footerStyle: 'prominent',
  };

  // ── Timeline computed ───────────────────────────────
  readonly timelineSteps = computed<TimelineStep[]>(() => {
    const dn = this.dispatch_note();
    const steps: TimelineStep[] = [];

    steps.push({
      key: 'created',
      label: 'Creada',
      status: 'completed',
      description: `por ${this.getUserName(dn.created_by_user)}`,
      date: this.formatDateTime(dn.created_at),
    });

    if (dn.confirmed_at) {
      steps.push({
        key: 'confirmed',
        label: 'Confirmada',
        status: 'completed',
        description: `por ${this.getUserName(dn.confirmed_by_user)}`,
        date: this.formatDateTime(dn.confirmed_at),
      });
    } else if (dn.status === 'draft') {
      steps.push({ key: 'confirmed', label: 'Confirmacion', status: 'current' });
    }

    if (dn.delivered_at) {
      steps.push({
        key: 'delivered',
        label: 'Entregada',
        status: 'completed',
        description: `por ${this.getUserName(dn.delivered_by_user)}`,
        date: this.formatDateTime(dn.delivered_at),
      });
    } else if (['draft', 'confirmed'].includes(dn.status)) {
      steps.push({ key: 'delivered', label: 'Entrega', status: 'upcoming' });
    }

    if (dn.voided_at) {
      steps.push({
        key: 'voided',
        label: 'Anulada',
        status: 'terminal',
        variant: 'danger',
        description: `por ${this.getUserName(dn.voided_by_user)}`,
        date: this.formatDateTime(dn.voided_at),
      });
    }

    return steps;
  });

  // ── Action handler ──────────────────────────────────
  onHeaderAction(id: string): void {
    const dn = this.dispatch_note();
    switch (id) {
      case 'confirm': this.confirmAction.emit(dn); break;
      case 'deliver': this.deliverAction.emit(dn); break;
      case 'invoice': this.invoiceAction.emit(dn); break;
      case 'print': this.printAction.emit(dn); break;
      case 'void': this.voidAction.emit(dn); break;
    }
  }

  // ── Utility methods ─────────────────────────────────
  formatCurrency(value: any): string {
    const num = typeof value === 'string' ? parseFloat(value) : (value || 0);
    return this.currencyService.format(num);
  }

  formatDate(date: string | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatDateTime(date: string | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getUserName(user: any): string {
    if (!user) return '-';
    return `${user.first_name || ''} ${user.last_name || ''}`.trim() || '-';
  }
}
