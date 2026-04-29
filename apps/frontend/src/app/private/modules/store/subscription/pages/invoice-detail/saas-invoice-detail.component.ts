import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  EmptyStateComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import {
  Invoice,
  InvoiceLineItem,
  InvoiceSplitBreakdown,
} from '../../interfaces/store-subscription.interface';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

interface InvoicePayment {
  id: number | string;
  state: 'pending' | 'succeeded' | 'failed' | 'refunded' | string;
  amount: string | number;
  currency?: string;
  payment_method?: string | null;
  gateway_reference?: string | null;
  paid_at?: string | null;
  created_at?: string;
}

interface InvoiceDetailVM {
  invoice: Invoice;
  line_items: InvoiceLineItem[];
  split_breakdown: InvoiceSplitBreakdown | null;
  payments: InvoicePayment[];
}

const STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  open: 'Pendiente',
  issued: 'Emitida',
  paid: 'Pagada',
  void: 'Anulada',
  uncollectible: 'Incobrable',
};

const STATE_BADGE_CLASS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border border-gray-200',
  open: 'bg-blue-50 text-blue-700 border border-blue-200',
  issued: 'bg-blue-50 text-blue-700 border border-blue-200',
  paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  void: 'bg-gray-100 text-gray-500 border border-gray-200',
  uncollectible: 'bg-red-50 text-red-700 border border-red-200',
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  succeeded: 'Exitoso',
  failed: 'Fallido',
  refunded: 'Reembolsado',
};

const PAYMENT_STATE_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  succeeded: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  failed: 'bg-red-50 text-red-700 border border-red-200',
  refunded: 'bg-gray-100 text-gray-700 border border-gray-200',
};

@Component({
  selector: 'app-saas-invoice-detail',
  standalone: true,
  imports: [
    CardComponent,
    ButtonComponent,
    IconComponent,
    EmptyStateComponent,
    CurrencyPipe,
    DecimalPipe,
    RouterLink,
  ],
  templateUrl: './saas-invoice-detail.component.html',
  styleUrls: ['./saas-invoice-detail.component.scss'],
})
export class SaasInvoiceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly detail = signal<InvoiceDetailVM | null>(null);
  readonly downloadingPdf = signal(false);

  readonly invoice = computed(() => this.detail()?.invoice ?? null);
  readonly lineItems = computed<InvoiceLineItem[]>(
    () => this.detail()?.line_items ?? [],
  );
  readonly splitBreakdown = computed<InvoiceSplitBreakdown | null>(
    () => this.detail()?.split_breakdown ?? null,
  );
  readonly payments = computed<InvoicePayment[]>(
    () => this.detail()?.payments ?? [],
  );
  readonly currency = computed(() => this.invoice()?.currency ?? 'COP');

  readonly billingCycleLabel = computed(() => {
    const first = this.lineItems()[0];
    const cycle = first?.meta?.billing_cycle;
    if (cycle === 'yearly') {
      return 'Anual';
    }
    if (cycle === 'monthly') {
      return 'Mensual';
    }
    return cycle ? cycle : '-';
  });

  readonly hasPlanChange = computed(() => {
    const items = this.lineItems();
    if (items.length < 2) {
      return false;
    }
    const codes = new Set(items.map((i) => i.meta?.plan_code).filter(Boolean));
    return codes.size > 1;
  });

  readonly stateLabel = computed(() => {
    const s = this.invoice()?.state;
    return s ? (STATE_LABELS[s] ?? s) : '';
  });

  readonly stateBadgeClass = computed(() => {
    const s = this.invoice()?.state;
    return s
      ? (STATE_BADGE_CLASS[s] ??
          'bg-gray-100 text-gray-700 border border-gray-200')
      : '';
  });

  readonly marginPctNumber = computed(() => {
    const raw = this.splitBreakdown()?.margin_pct_used;
    if (raw === undefined || raw === null) {
      return null;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      this.loading.set(false);
      return;
    }
    this.loadInvoice(id);
  }

  paymentStateLabel(state: string): string {
    return PAYMENT_STATE_LABELS[state] ?? state;
  }

  paymentStateBadgeClass(state: string): string {
    return (
      PAYMENT_STATE_BADGE_CLASS[state] ??
      'bg-gray-100 text-gray-700 border border-gray-200'
    );
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }
    return formatDateOnlyUTC(value);
  }

  goBack(): void {
    this.router.navigate(['/admin/subscription/history']);
  }

  /**
   * S3.1 — Triggers the PDF download for the current invoice. The blob
   * returned by the backend is wrapped in an object URL and clicked from
   * a transient anchor so the browser handles the save dialog.
   */
  downloadPdf(): void {
    const inv = this.invoice();
    if (!inv?.id || this.downloadingPdf()) {
      return;
    }
    this.downloadingPdf.set(true);
    this.subscriptionService
      .downloadInvoicePdf(inv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) {
            this.downloadingPdf.set(false);
            this.toastService.error('No se pudo generar el PDF');
            return;
          }
          const filename = this.extractFilename(
            response.headers.get('content-disposition'),
          ) ?? `factura-${inv.invoice_number}.pdf`;
          this.saveBlob(blob, filename);
          this.downloadingPdf.set(false);
        },
        error: () => {
          this.downloadingPdf.set(false);
          this.toastService.error('Error al descargar el PDF');
        },
      });
  }

  private extractFilename(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
    return match?.[1] ?? null;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Defer revoke so the browser has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Loads the invoice detail from the backend.
   *
   * TODO(G5-backend): The current backend endpoint
   *   GET /store/subscriptions/current/invoices/:id
   * returns the raw subscription_invoices record (with line_items +
   * split_breakdown as JSON columns) but does NOT eagerly include the
   * subscription_payments[] for the invoice. Once the backend is updated
   * to include `payments`, this fallback can be removed.
   *
   * Until then we display an empty payments list with a clear empty state.
   */
  private loadInvoice(id: string): void {
    this.loading.set(true);
    this.subscriptionService
      .getInvoice(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (!res.success || !res.data) {
            this.notFound.set(true);
            this.loading.set(false);
            return;
          }
          const raw = res.data as Record<string, any>;
          const detail = this.normalizeDetail(raw);
          this.detail.set(detail);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          if (err?.status === 404) {
            this.notFound.set(true);
            return;
          }
          this.toastService.error('Error al cargar el detalle de la factura');
        },
      });
  }

  private normalizeDetail(raw: Record<string, any>): InvoiceDetailVM {
    const invoice: Invoice = {
      id: String(raw['id']),
      invoice_number: String(raw['invoice_number'] ?? ''),
      amount: Number(raw['subtotal'] ?? raw['amount'] ?? 0),
      currency: String(raw['currency'] ?? 'COP'),
      tax: Number(raw['tax_amount'] ?? raw['tax'] ?? 0),
      total: Number(raw['total'] ?? 0),
      state: raw['state'],
      period_start: raw['period_start'],
      period_end: raw['period_end'],
      due_date: raw['due_at'] ?? raw['due_date'],
      paid_at: raw['paid_at'] ?? null,
      created_at: raw['created_at'],
    };

    const lineItems = Array.isArray(raw['line_items'])
      ? (raw['line_items'] as InvoiceLineItem[])
      : [];

    const splitRaw = raw['split_breakdown'];
    const splitBreakdown =
      splitRaw &&
      typeof splitRaw === 'object' &&
      (splitRaw.partner_org_id !== null && splitRaw.partner_org_id !== undefined)
        ? (splitRaw as InvoiceSplitBreakdown)
        : null;

    const payments: InvoicePayment[] = Array.isArray(raw['payments'])
      ? (raw['payments'] as InvoicePayment[])
      : [];

    return {
      invoice,
      line_items: lineItems,
      split_breakdown: splitBreakdown,
      payments,
    };
  }
}
