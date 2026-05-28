import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService } from '../../../services';
import { PurchaseOrderTimelineEntry } from '../../../interfaces';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

interface TimelineDetail {
  label: string;
  value: string;
}

interface TimelineDisplayItem {
  type: 'audit' | 'reception' | 'payment' | 'attachment';
  icon: string;
  color: string;
  bg_color: string;
  title: string;
  description: string;
  date: string;
  user: string;
  details: TimelineDetail[];
}

@Component({
  selector: 'app-po-timeline',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-8">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    } @else if (displayItems().length === 0) {
      <div class="flex flex-col items-center py-8 text-center">
        <app-icon name="clock" [size]="32" class="text-text-muted mb-2"></app-icon>
        <p class="text-sm text-text-secondary">No hay eventos registrados</p>
      </div>
    } @else {
      <div class="relative pl-6 md:pl-8">
        <div class="absolute left-[11px] md:left-[15px] top-2 bottom-2 w-0.5 bg-border"></div>

        @for (item of displayItems(); track $index) {
          <div class="relative pb-6 last:pb-0">
            <div
              class="absolute -left-6 md:-left-8 w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center border-2 border-surface"
              [class]="item.bg_color"
            >
              <app-icon [name]="item.icon" [size]="12" [class]="item.color"></app-icon>
            </div>

            <div class="ml-2 md:ml-4 rounded-lg border border-border/50 bg-surface/40 p-3">
              <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 class="text-sm font-semibold text-text-primary">{{ item.title }}</h4>
                  <p class="text-xs text-text-secondary mt-0.5">{{ item.description }}</p>
                </div>
                <time class="text-[11px] text-text-muted whitespace-nowrap">
                  {{ formatDateTime(item.date) }}
                </time>
              </div>

              @if (item.details.length > 0) {
                <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
                  @for (detail of item.details; track detail.label) {
                    <div class="min-w-0">
                      <dt class="text-[10px] text-text-muted uppercase tracking-wider">{{ detail.label }}</dt>
                      <dd class="text-xs text-text-primary break-words">{{ detail.value }}</dd>
                    </div>
                  }
                </dl>
              }

              @if (item.user) {
                <p class="text-[10px] text-text-muted mt-3">por {{ item.user }}</p>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`:host { display: block; }`],
})
export class PoTimelineComponent {
  private destroyRef = inject(DestroyRef);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private currencyService = inject(CurrencyFormatService);

  readonly orderId = input<number | null>(null);

  readonly loading = signal(false);
  readonly displayItems = signal<TimelineDisplayItem[]>([]);

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (id) {
        this.loadTimeline(id);
      } else {
        this.displayItems.set([]);
      }
    });
  }

  loadTimeline(orderId: number): void {
    this.loading.set(true);
    this.purchaseOrdersService.getPurchaseOrderTimeline(orderId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        const entries = response.data || [];
        this.displayItems.set(
          entries.map((entry: PurchaseOrderTimelineEntry) => this.mapEntry(entry))
        );
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.displayItems.set([]);
      },
    });
  }

  formatDateTime(value: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private mapEntry(entry: PurchaseOrderTimelineEntry): TimelineDisplayItem {
    const data = entry.data as Record<string, unknown>;

    switch (entry.type) {
      case 'reception':
        return {
          type: 'reception',
          icon: 'package-check',
          color: 'text-success',
          bg_color: 'bg-success/10',
          title: 'Recepción de mercancía',
          description: this.getReceptionDescription(data),
          date: entry.date,
          user: this.getUserName(data),
          details: this.getReceptionDetails(data),
        };

      case 'payment':
        return {
          type: 'payment',
          icon: 'dollar-sign',
          color: 'text-primary',
          bg_color: 'bg-primary/10',
          title: 'Pago registrado',
          description: this.getPaymentDescription(data),
          date: entry.date,
          user: this.getUserName(data),
          details: this.getPaymentDetails(data),
        };

      case 'attachment':
        return {
          type: 'attachment',
          icon: 'paperclip',
          color: 'text-primary',
          bg_color: 'bg-primary/10',
          title: 'Adjunto agregado',
          description: this.getAttachmentDescription(data),
          date: entry.date,
          user: this.getUserName(data),
          details: this.getAttachmentDetails(data),
        };

      case 'audit':
      default:
        return {
          type: 'audit',
          icon: this.getAuditIcon(data),
          color: this.getAuditColor(data),
          bg_color: this.getAuditBg(data),
          title: this.getAuditTitle(data),
          description: this.getAuditDescription(data),
          date: entry.date,
          user: this.getUserName(data),
          details: this.getAuditDetails(data),
        };
    }
  }

  private getReceptionDescription(data: Record<string, unknown>): string {
    const items = this.getArray(data['items']);
    const totalQty = items.reduce((sum, item) => sum + (Number(item['quantity_received']) || 0), 0);

    if (items.length > 0) {
      return `${totalQty} unidad(es) recibida(s) en ${items.length} línea(s)`;
    }

    return this.toText(data['notes']) || 'Mercancía recibida';
  }

  private getReceptionDetails(data: Record<string, unknown>): TimelineDetail[] {
    const items = this.getArray(data['items']);
    const details = items
      .map((item) => {
        const orderItem = this.asRecord(item['purchase_order_item']);
        const product = this.asRecord(orderItem?.['products']) || this.asRecord(orderItem?.['product']);
        const variant = this.asRecord(orderItem?.['product_variants']);
        const name = this.toText(product?.['name']) || 'Producto';
        const sku = this.toText(variant?.['sku']) || this.toText(product?.['sku']);
        const quantity = Number(item['quantity_received']) || 0;
        return {
          label: sku ? `${name} (${sku})` : name,
          value: `${quantity} unidad(es)`,
        };
      });

    return this.withOptionalDetails(details, [
      { label: 'Notas', value: this.toText(data['notes']) },
    ]);
  }

  private getPaymentDescription(data: Record<string, unknown>): string {
    const amount = this.formatCurrencyValue(data['amount']);
    const method = this.getPaymentMethodLabel(this.toText(data['payment_method']));
    return `${amount} por ${method}`;
  }

  private getPaymentDetails(data: Record<string, unknown>): TimelineDetail[] {
    return this.withOptionalDetails([], [
      { label: 'Fecha de pago', value: this.formatDateOnly(data['payment_date']) },
      { label: 'Método', value: this.getPaymentMethodLabel(this.toText(data['payment_method'])) },
      { label: 'Referencia', value: this.toText(data['reference']) },
      { label: 'Notas', value: this.toText(data['notes']) },
    ]);
  }

  private getAttachmentDescription(data: Record<string, unknown>): string {
    return this.toText(data['file_name']) || 'Archivo adjunto';
  }

  private getAttachmentDetails(data: Record<string, unknown>): TimelineDetail[] {
    return this.withOptionalDetails([], [
      { label: 'Tipo', value: this.toText(data['file_type']) },
      { label: 'Tamaño', value: this.formatFileSize(Number(data['file_size']) || 0) },
      { label: 'Factura proveedor', value: this.toText(data['supplier_invoice_number']) },
      { label: 'Fecha factura', value: this.formatDateOnly(data['supplier_invoice_date']) },
      { label: 'Valor factura', value: this.formatCurrencyValue(data['supplier_invoice_amount']) },
      { label: 'Notas', value: this.toText(data['notes']) },
    ]);
  }

  private getAuditIcon(data: Record<string, unknown>): string {
    const action = this.normalizedAction(data);
    if (action.includes('payment')) return 'dollar-sign';
    if (action.includes('attachment')) return 'paperclip';
    if (action.includes('received')) return 'package-check';
    if (action.includes('created') || action.includes('create')) return 'plus-circle';
    if (action.includes('approved') || action.includes('approve')) return 'check-circle';
    if (action.includes('cancelled') || action.includes('cancel')) return 'x-circle';
    if (action.includes('submitted') || action.includes('submit')) return 'send';
    return 'clock';
  }

  private getAuditColor(data: Record<string, unknown>): string {
    const action = this.normalizedAction(data);
    if (action.includes('cancel')) return 'text-destructive';
    if (action.includes('approve') || action.includes('received')) return 'text-success';
    if (action.includes('created') || action.includes('payment') || action.includes('attachment')) return 'text-primary';
    return 'text-text-secondary';
  }

  private getAuditBg(data: Record<string, unknown>): string {
    const action = this.normalizedAction(data);
    if (action.includes('cancel')) return 'bg-destructive/10';
    if (action.includes('approve') || action.includes('received')) return 'bg-success/10';
    if (action.includes('created') || action.includes('payment') || action.includes('attachment')) return 'bg-primary/10';
    return 'bg-muted/30';
  }

  private getAuditTitle(data: Record<string, unknown>): string {
    const action = this.normalizedAction(data);
    if (action.includes('created')) return 'Orden creada';
    if (action.includes('approved')) return 'Orden aprobada';
    if (action.includes('cancelled')) return 'Orden cancelada';
    if (action.includes('submitted')) return 'Orden enviada';
    if (action.includes('updated')) return 'Orden actualizada';
    if (action.includes('partially_received')) return 'Recepción parcial registrada';
    if (action.includes('received')) return 'Recepción completada';
    if (action.includes('payment_registered')) return 'Pago registrado';
    if (action.includes('attachment_added')) return 'Adjunto agregado';
    return this.toText(data['title']) || this.toText(data['action']) || 'Evento';
  }

  private getAuditDescription(data: Record<string, unknown>): string {
    const action = this.normalizedAction(data);
    const values = this.asRecord(data['new_values']) || this.asRecord(data['old_values']);

    if (action.includes('payment_registered')) {
      if (!values) return 'Pago registrado en la orden';
      const amount = this.formatCurrencyValue(values?.['amount']);
      const method = this.getPaymentMethodLabel(this.toText(values?.['method']));
      return `${amount} por ${method}`;
    }

    if (action.includes('attachment_added')) {
      return this.toText(values?.['file_name']) || 'Archivo adjunto agregado';
    }

    if (action.includes('partially_received')) {
      const count = this.toText(values?.['items_count']);
      return count ? `${count} línea(s) recibida(s) parcialmente` : 'Recepción parcial registrada';
    }

    if (action.includes('received')) {
      const count = this.toText(values?.['items_count']);
      return count ? `${count} línea(s) recibida(s)` : 'Orden recibida completamente';
    }

    if (action.includes('created')) return 'Se creó la orden de compra';
    if (action.includes('approved')) return 'La orden quedó aprobada para recepción';
    if (action.includes('cancelled')) return 'La orden fue cancelada';
    if (action.includes('updated')) return 'Se actualizaron datos de la orden';

    return this.toText(data['description']) || 'Evento de auditoría registrado';
  }

  private getAuditDetails(data: Record<string, unknown>): TimelineDetail[] {
    const values = this.asRecord(data['new_values']) || this.asRecord(data['old_values']);
    if (!values) return [];

    return this.withOptionalDetails([], [
      { label: 'Orden', value: this.toText(values['order_number']) || this.toText(values['purchase_order_id']) },
      { label: 'Monto', value: this.formatCurrencyValue(values['amount']) },
      { label: 'Método', value: this.getPaymentMethodLabel(this.toText(values['method'])) },
      { label: 'Archivo', value: this.toText(values['file_name']) },
      { label: 'Líneas', value: this.toText(values['items_count']) },
    ]);
  }

  private getUserName(data: Record<string, unknown>): string {
    const user =
      this.asRecord(data['user']) ||
      this.asRecord(data['users']) ||
      this.asRecord(data['received_by']) ||
      this.asRecord(data['created_by']) ||
      this.asRecord(data['uploaded_by']);

    if (!user) return '';

    const first = this.toText(user['first_name']);
    const last = this.toText(user['last_name']);
    const username = this.toText(user['username']) || this.toText(user['user_name']);
    const email = this.toText(user['email']);

    return first || last ? `${first} ${last}`.trim() : username || email;
  }

  private getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia bancaria',
      check: 'Cheque',
      credit_card: 'Tarjeta de crédito',
    };
    return labels[method] || method || 'Sin método';
  }

  private normalizedAction(data: Record<string, unknown>): string {
    return this.toText(data['action']).toLowerCase();
  }

  private withOptionalDetails(base: TimelineDetail[], optional: TimelineDetail[]): TimelineDetail[] {
    return [
      ...base,
      ...optional.filter((detail) => detail.value && detail.value !== '—' && detail.value !== '$0'),
    ];
  }

  private formatCurrencyValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    return this.currencyService.format(Number(value) || 0);
  }

  private formatDateOnly(value: unknown): string {
    if (!value) return '—';
    return formatDateOnlyUTC(String(value));
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  private getArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private toText(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
