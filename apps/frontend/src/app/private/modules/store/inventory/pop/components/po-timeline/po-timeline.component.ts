import {
  Component,
  inject,
  input,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService } from '../../../services';
import { PurchaseOrderTimelineEntry } from '../../../interfaces';

interface TimelineDisplayItem {
  type: 'audit' | 'reception' | 'payment';
  icon: string;
  color: string;
  bg_color: string;
  title: string;
  description: string;
  date: string;
  user: string;
}

@Component({
  selector: 'app-po-timeline',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
        <!-- Vertical line -->
        <div class="absolute left-[11px] md:left-[15px] top-2 bottom-2 w-0.5 bg-border"></div>

        @for (item of displayItems(); track $index) {
          <div class="relative pb-6 last:pb-0">
            <!-- Icon dot -->
            <div
              class="absolute -left-6 md:-left-8 w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center border-2 border-surface"
              [class]="item.bg_color"
            >
              <app-icon [name]="item.icon" [size]="12" [class]="item.color"></app-icon>
            </div>

            <!-- Content -->
            <div class="ml-2 md:ml-4">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h4 class="text-sm font-medium text-text-primary">{{ item.title }}</h4>
                <time class="text-xs text-text-muted">{{ item.date | date:'dd/MM/yyyy HH:mm' }}</time>
              </div>
              <p class="text-xs text-text-secondary mt-0.5">{{ item.description }}</p>
              @if (item.user) {
                <p class="text-[10px] text-text-muted mt-0.5">por {{ item.user }}</p>
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
  private purchaseOrdersService = inject(PurchaseOrdersService);

  readonly orderId = input<number | null>(null);

  readonly loading = signal(false);
  readonly displayItems = signal<TimelineDisplayItem[]>([]);

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (id) {
        this.loadTimeline(id);
      }
    });
  }

  loadTimeline(orderId: number): void {
    this.loading.set(true);
    this.purchaseOrdersService.getPurchaseOrderTimeline(orderId).subscribe({
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

  private mapEntry(entry: PurchaseOrderTimelineEntry): TimelineDisplayItem {
    const data = entry.data as Record<string, unknown>;

    switch (entry.type) {
      case 'reception':
        return {
          type: 'reception',
          icon: 'package-check',
          color: 'text-success',
          bg_color: 'bg-success/10',
          title: 'Recepcion de mercancia',
          description: this.getReceptionDescription(data),
          date: entry.date,
          user: this.getUserName(data),
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
        };

      case 'audit':
      default:
        return {
          type: 'audit',
          icon: this.getAuditIcon(data),
          color: this.getAuditColor(data),
          bg_color: this.getAuditBg(data),
          title: this.getAuditTitle(data),
          description: (data['description'] as string) || '',
          date: entry.date,
          user: this.getUserName(data),
        };
    }
  }

  private getReceptionDescription(data: Record<string, unknown>): string {
    const items = data['items'] as Array<Record<string, unknown>> | undefined;
    if (items?.length) {
      const totalQty = items.reduce((sum, i) => sum + (Number(i['quantity_received']) || 0), 0);
      return `${totalQty} unidad(es) recibida(s) en ${items.length} linea(s)`;
    }
    const notes = data['notes'] as string;
    return notes || 'Mercancia recibida';
  }

  private getPaymentDescription(data: Record<string, unknown>): string {
    const amount = data['amount'] as number;
    const method = data['payment_method'] as string;
    const methodLabels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia',
      check: 'Cheque',
      credit_card: 'Tarjeta',
    };
    const label = methodLabels[method] || method || '';
    return amount ? `$${Number(amount).toLocaleString()} - ${label}` : label;
  }

  private getAuditIcon(data: Record<string, unknown>): string {
    const action = (data['action'] as string) || '';
    if (action.includes('create')) return 'plus-circle';
    if (action.includes('approve')) return 'check-circle';
    if (action.includes('cancel')) return 'x-circle';
    if (action.includes('submit')) return 'send';
    return 'clock';
  }

  private getAuditColor(data: Record<string, unknown>): string {
    const action = (data['action'] as string) || '';
    if (action.includes('cancel')) return 'text-destructive';
    if (action.includes('approve')) return 'text-success';
    if (action.includes('create')) return 'text-primary';
    return 'text-text-secondary';
  }

  private getAuditBg(data: Record<string, unknown>): string {
    const action = (data['action'] as string) || '';
    if (action.includes('cancel')) return 'bg-destructive/10';
    if (action.includes('approve')) return 'bg-success/10';
    if (action.includes('create')) return 'bg-primary/10';
    return 'bg-muted/30';
  }

  private getAuditTitle(data: Record<string, unknown>): string {
    const action = (data['action'] as string) || '';
    if (action.includes('create')) return 'Orden creada';
    if (action.includes('approve')) return 'Orden aprobada';
    if (action.includes('cancel')) return 'Orden cancelada';
    if (action.includes('submit')) return 'Orden enviada';
    if (action.includes('update')) return 'Orden actualizada';
    return (data['title'] as string) || 'Evento';
  }

  private getUserName(data: Record<string, unknown>): string {
    const user = data['user'] as Record<string, unknown> | undefined;
    if (user) {
      const first = (user['first_name'] as string) || '';
      const last = (user['last_name'] as string) || '';
      const userName = (user['user_name'] as string) || '';
      return first || last ? `${first} ${last}`.trim() : userName;
    }
    const receivedBy = data['received_by'] as Record<string, unknown> | undefined;
    if (receivedBy) {
      const first = (receivedBy['first_name'] as string) || '';
      const last = (receivedBy['last_name'] as string) || '';
      return `${first} ${last}`.trim();
    }
    const createdBy = data['created_by'] as Record<string, unknown> | undefined;
    if (createdBy) {
      const first = (createdBy['first_name'] as string) || '';
      const last = (createdBy['last_name'] as string) || '';
      return `${first} ${last}`.trim();
    }
    return '';
  }
}
