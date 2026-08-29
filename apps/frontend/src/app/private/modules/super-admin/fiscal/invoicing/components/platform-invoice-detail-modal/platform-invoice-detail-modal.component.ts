import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  ConfirmationModalComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components';
import type { ItemListCardConfig } from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { environment } from '../../../../../../../../environments/environment';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import {
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

@Component({
  selector: 'app-platform-invoice-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    DecimalPipe,
    NgClass,
    VendixCurrencyPipe,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    ConfirmationModalComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      [title]="modalTitle()"
      size="xl"
    >
      @if (loading()) {
        <div class="p-8 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-sm text-text-secondary">Cargando detalle fiscal…</p>
        </div>
      } @else if (error(); as err) {
        <div class="p-6">
          <app-alert-banner variant="danger">{{ err }}</app-alert-banner>
        </div>
      } @else if (detail(); as d) {
        <div class="p-6 space-y-6">
          <!-- ── RECHAZO DIAN (SI APLICA) ── -->
          @if (d.transmission?.transmission_status === 'rejected' || d.transmission?.error_message) {
            <div
              role="alert"
              class="rounded-lg border border-error bg-error-light p-4 space-y-2"
            >
              <div class="flex items-start gap-2">
                <app-icon name="alert-triangle" [size]="18" class="text-error mt-0.5" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-error">La DIAN rechazó el documento</p>
                  <p class="text-sm text-error">
                    {{ d.transmission?.error_message ?? 'Error en la validación del documento fiscal' }}
                  </p>
                </div>
              </div>
              @if (d.transmission?.cufe) {
                <p class="text-xs text-error font-mono break-all pt-1">
                  CUFE: {{ d.transmission.cufe }}
                </p>
              }
            </div>
          }

          <!-- ── MATRIZ DE ESTADO FISCAL (3 FASES) ── -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="rounded-card border border-border bg-[var(--color-surface)] p-3.5 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  1. Transmisión DIAN
                </span>
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  [class]="transmissionStatusBadgeClasses(d.transmission?.transmission_status ?? d.invoice?.state)"
                >
                  {{ transmissionStatusLabel(d.transmission?.transmission_status ?? d.invoice?.state) }}
                </span>
              </div>
              <p class="text-xs text-text-secondary truncate">
                {{ d.transmission?.document_number ?? d.invoice?.invoice_number ?? 'Sin consecutivo' }}
              </p>
            </div>

            <div class="rounded-card border border-border bg-[var(--color-surface)] p-3.5 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  2. Entrega Adquirente
                </span>
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  [class]="d.deliveryStatus === 'delivered' ? 'bg-success-light text-success border-success' : 'bg-warning-light text-warning border-warning'"
                >
                  {{ d.deliveryStatus === 'delivered' ? 'Entregada' : 'Pendiente' }}
                </span>
              </div>
              <p class="text-xs text-text-secondary truncate">
                {{ d.acquirer?.email ?? d.organization?.email ?? 'Sin email registrado' }}
              </p>
            </div>

            <div class="rounded-card border border-border bg-[var(--color-surface)] p-3.5 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  3. Aceptación RADIAN
                </span>
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  [class]="radianStatusClass()"
                >
                  {{ radianStatusLabel() }}
                </span>
              </div>
              <p class="text-xs text-text-secondary truncate">
                {{ events().length }} eventos registrados
              </p>
            </div>
          </div>

          <!-- ── BARRA DE ACCIONES PRINCIPALES ── -->
          <div class="flex flex-wrap items-center justify-between gap-2 p-3 bg-[var(--color-surface-secondary)] rounded-card border border-border">
            <div class="flex items-center gap-2">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onPrintPdf()"
                [loading]="printingPdf()"
                [disabled]="!d.transmission?.document_number"
              >
                <app-icon slot="icon" name="printer" [size]="14"></app-icon>
                Imprimir PDF
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="onDownloadXml()"
                [disabled]="!d.transmission?.cufe"
              >
                <app-icon slot="icon" name="download" [size]="14"></app-icon>
                Descargar XML
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="openDeliverModal()"
              >
                <app-icon slot="icon" name="mail" [size]="14"></app-icon>
                Reenviar Correo
              </app-button>
            </div>

            <div class="flex items-center gap-2">
              @if (canRetry()) {
                <app-button
                  variant="primary"
                  size="sm"
                  [loading]="retrying()"
                  (clicked)="onRetryTransmission()"
                >
                  <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                  Reintentar Emisión
                </app-button>
              }

              <app-button
                variant="ghost"
                size="sm"
                (clicked)="openRegisterEventModal()"
                [disabled]="!d.transmission?.cufe"
              >
                <app-icon slot="icon" name="file-check" [size]="14"></app-icon>
                Registrar Evento
              </app-button>
            </div>
          </div>

          <!-- ── RESUMEN + DESTINATARIO ── -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Datos del documento -->
            <div class="bg-[var(--color-surface)] rounded-card border border-border p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Información del Documento
              </h3>
              <dl class="grid grid-cols-2 gap-y-2 text-xs">
                <dt class="text-text-secondary">Número</dt>
                <dd class="font-medium text-text-primary">{{ d.transmission?.document_number ?? d.invoice?.invoice_number }}</dd>

                <dt class="text-text-secondary">Fecha Emisión</dt>
                <dd class="text-text-primary">{{ (d.transmission?.created_at ?? d.invoice?.issued_at) | date: 'medium' }}</dd>

                <dt class="text-text-secondary">Forma de Pago</dt>
                <dd class="text-text-primary">{{ d.invoice?.payment_form === '2' ? 'Crédito' : 'Contado' }}</dd>

                @if (d.invoice?.due_date) {
                  <dt class="text-text-secondary">Vencimiento</dt>
                  <dd class="text-text-primary">{{ d.invoice.due_date | date: 'mediumDate' }}</dd>
                }

                @if (d.transmission?.cufe) {
                  <dt class="text-text-secondary">CUFE</dt>
                  <dd class="font-mono text-text-secondary truncate" [title]="d.transmission.cufe">
                    {{ d.transmission.cufe }}
                  </dd>
                }
              </dl>
            </div>

            <!-- Datos del Adquirente / Cliente -->
            <div class="bg-[var(--color-surface)] rounded-card border border-border p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Adquirente / Cliente
              </h3>
              <dl class="grid grid-cols-2 gap-y-2 text-xs">
                <dt class="text-text-secondary">Razón Social</dt>
                <dd class="font-medium text-text-primary">{{ d.acquirer?.legal_name ?? d.organization?.legal_name ?? d.organization?.name ?? '—' }}</dd>

                <dt class="text-text-secondary">Identificación / NIT</dt>
                <dd class="font-mono text-text-primary">{{ d.acquirer?.tax_id ?? d.organization?.tax_id ?? 'Sin NIT' }}</dd>

                <dt class="text-text-secondary">Correo</dt>
                <dd class="text-text-primary truncate">{{ d.acquirer?.email ?? d.organization?.email ?? '—' }}</dd>

                @if (d.acquirer?.address?.line) {
                  <dt class="text-text-secondary">Dirección</dt>
                  <dd class="text-text-primary">{{ d.acquirer.address.line }} ({{ d.acquirer.address.city }})</dd>
                }
              </dl>
            </div>
          </div>

          <!-- ── TABLA DE LÍNEAS / ITEMS ── -->
          @if (lines().length > 0) {
            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Líneas del Documento ({{ lines().length }})
              </h3>
              <app-responsive-data-view
                [data]="lines()"
                [columns]="lineColumns"
                [cardConfig]="linesCardConfig"
                [loading]="false"
              />
            </div>
          }

          <!-- ── TOTALES MONETARIOS ── -->
          <div class="flex justify-end">
            <div class="w-full md:w-80 bg-[var(--color-surface)] rounded-card border border-border p-4 space-y-2 text-xs">
              <div class="flex justify-between text-text-secondary">
                <span>Subtotal</span>
                <span class="font-medium text-text-primary">{{ d.subtotal | currency }}</span>
              </div>
              @if (d.discount > 0) {
                <div class="flex justify-between text-text-secondary">
                  <span>Descuentos</span>
                  <span class="text-error">- {{ d.discount | currency }}</span>
                </div>
              }
              <div class="flex justify-between text-text-secondary">
                <span>Impuestos (IVA / INC)</span>
                <span class="font-medium text-text-primary">{{ d.tax_amount | currency }}</span>
              </div>
              @if (d.withholdings > 0) {
                <div class="flex justify-between text-text-secondary">
                  <span>Retenciones</span>
                  <span class="text-warning">- {{ d.withholdings | currency }}</span>
                </div>
              }
              <div class="pt-2 border-t border-border flex justify-between text-sm font-bold text-text-primary">
                <span>Total a Pagar</span>
                <span class="text-primary">{{ d.total | currency }}</span>
              </div>
            </div>
          </div>

          <!-- ── EVENTOS RADIAN TIMELINE ── -->
          <div class="space-y-3 pt-2">
            <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Historial de Eventos RADIAN
            </h3>
            @if (events().length === 0) {
              <p class="text-xs text-text-secondary italic">
                No hay eventos registrados para esta factura.
              </p>
            } @else {
              <div class="space-y-2">
                @for (ev of events(); track ev.id) {
                  <div class="flex items-center justify-between p-3 rounded-card border border-border bg-[var(--color-surface)] text-xs">
                    <div class="space-y-0.5">
                      <div class="font-medium text-text-primary flex items-center gap-2">
                        <span>Evento {{ ev.event_code }}</span>
                        <span
                          class="px-2 py-0.5 rounded-full text-[10px]"
                          [class]="ev.status === 'accepted' ? 'bg-success-light text-success' : 'bg-warning-light text-warning'"
                        >
                          {{ ev.status }}
                        </span>
                      </div>
                      <p class="text-text-secondary font-mono">CUDE: {{ ev.cude ?? 'Pendiente' }}</p>
                    </div>
                    <span class="text-text-secondary">{{ ev.created_at | date: 'short' }}</span>
                  </div>
                }
              </div>
            }
          </div>
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onClose()">Cerrar</app-button>
      </div>
    </app-modal>

    <!-- Modal Reenvío Email -->
    <app-modal
      [(isOpen)]="isDeliverModalOpen"
      title="Reenviar Factura por Correo"
      size="md"
    >
      <div class="p-4 space-y-4">
        <app-input
          label="Correo electrónico de destino"
          type="email"
          [(ngModel)]="deliverEmail"
          placeholder="ejemplo@empresa.com"
        />
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="isDeliverModalOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="delivering()" (clicked)="onConfirmDeliver()">Enviar</app-button>
      </div>
    </app-modal>

    <!-- Modal Registrar Evento RADIAN -->
    <app-modal
      [(isOpen)]="isEventModalOpen"
      title="Registrar Evento RADIAN"
      size="md"
    >
      <div class="p-4 space-y-4">
        <app-selector
          label="Tipo de Evento"
          [(ngModel)]="selectedEventCode"
          [options]="eventOptions"
        />
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="isEventModalOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" [loading]="registeringEvent()" (clicked)="onConfirmEvent()">Registrar</app-button>
      </div>
    </app-modal>
  `,
})
export class PlatformInvoiceDetailModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly invoiceId = input<number | null>(null);
  readonly invoiceKind = input<'subscription' | 'platform'>('platform');
  readonly invoiceUpdated = output<void>();

  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly detail = signal<any | null>(null);
  readonly lines = signal<any[]>([]);
  readonly events = signal<any[]>([]);

  readonly printingPdf = signal(false);
  readonly retrying = signal(false);
  readonly delivering = signal(false);
  readonly registeringEvent = signal(false);

  readonly isDeliverModalOpen = signal(false);
  readonly deliverEmail = signal('');

  readonly isEventModalOpen = signal(false);
  readonly selectedEventCode = signal('030');

  readonly transmissionStatusBadgeClasses = transmissionStatusBadgeClasses;
  readonly transmissionStatusLabel = transmissionStatusLabel;

  readonly eventOptions = [
    { value: '030', label: '030 - Acuse de recibo de factura electrónica' },
    { value: '031', label: '031 - Reclamo de factura electrónica' },
    { value: '032', label: '032 - Recibo del bien o prestación del servicio' },
    { value: '033', label: '033 - Aceptación expresa' },
  ];

  readonly lineColumns: TableColumn[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'quantity', label: 'Cant.', align: 'right' },
    {
      key: 'unit_price',
      label: 'Precio Unit.',
      align: 'right',
      transform: (val: number) => `$${(Number(val) || 0).toLocaleString('es-CO')}`,
    },
    { key: 'tax_rate', label: 'Tarifa IVA', align: 'right' },
    {
      key: 'tax_amount',
      label: 'Impuesto',
      align: 'right',
      transform: (val: number) => `$${(Number(val) || 0).toLocaleString('es-CO')}`,
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      transform: (val: number) => `$${(Number(val) || 0).toLocaleString('es-CO')}`,
    },
  ];

  readonly linesCardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'quantity',
    subtitleTransform: (row: any) => `Cant: ${row.quantity}`,
    detailKeys: [
      {
        key: 'unit_price',
        label: 'Precio',
        transform: (val: number) => `$${(Number(val) || 0).toLocaleString('es-CO')}`,
      },
      {
        key: 'total',
        label: 'Total',
        transform: (val: number) => `$${(Number(val) || 0).toLocaleString('es-CO')}`,
      },
    ],
  };

  readonly modalTitle = computed(() => {
    const d = this.detail();
    if (!d) return 'Detalle de Factura';
    return `Factura ${d.transmission?.document_number ?? d.invoice?.invoice_number ?? ''}`;
  });

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.invoiceId();
      if (open && id) {
        this.loadDetail(id);
      }
    });
  }

  loadDetail(id: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.fiscal
      .getInvoice(id, this.invoiceKind())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data: any) => {
          this.processInvoiceData(data);
          this.loadEvents(id);
          this.loading.set(false);
        },
        error: (err: any) => {
          this.error.set(err?.error?.message ?? 'No se pudo cargar el detalle');
          this.loading.set(false);
        },
      });
  }

  private processInvoiceData(data: any): void {
    const invoice = data.invoice ?? data;
    const transmission = data.transmissions?.[0] ?? data.transmission ?? null;
    const acquirer = data.customer ?? data.acquirer ?? null;
    const organization = data.organization ?? null;

    // Normalizar líneas
    const items = data.items ?? invoice?.line_items ?? [];
    const formattedLines = items.map((it: any) => ({
      description: it.description ?? it.concept ?? 'Ítem de suscripción',
      quantity: it.quantity ?? 1,
      unit_price: Number(it.unit_price ?? it.amount ?? 0),
      tax_rate: `${it.tax_rate ?? it.taxes?.[0]?.rate ?? 19}%`,
      tax_amount: Number(it.tax_amount ?? 0),
      total: Number(it.total ?? (Number(it.quantity ?? 1) * Number(it.unit_price ?? 0))),
    }));
    this.lines.set(formattedLines);

    this.detail.set({
      invoice,
      transmission,
      acquirer,
      organization,
      subtotal: Number(invoice?.subtotal ?? 0),
      tax_amount: Number(invoice?.tax_amount ?? 0),
      discount: Number(invoice?.discount_amount ?? 0),
      withholdings: Number(invoice?.withholding_amount ?? 0),
      total: Number(invoice?.total ?? 0),
      deliveryStatus: transmission?.delivery_status ?? 'pending',
    });

    if (acquirer?.email || organization?.email) {
      this.deliverEmail.set(acquirer?.email ?? organization?.email);
    }
  }

  loadEvents(id: number): void {
    this.fiscal
      .listPlatformDianEvents(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (evts: any[]) => this.events.set(evts ?? []),
        error: () => this.events.set([]),
      });
  }

  radianStatusClass(): string {
    const evts = this.events();
    if (evts.some((e) => e.event_code === '033' && e.status === 'accepted')) {
      return 'bg-success-light text-success border-success';
    }
    if (evts.some((e) => e.event_code === '031')) {
      return 'bg-error-light text-error border-error';
    }
    return 'bg-[var(--color-surface-secondary)] text-text-secondary border-border';
  }

  radianStatusLabel(): string {
    const evts = this.events();
    if (evts.some((e) => e.event_code === '033' && e.status === 'accepted')) return 'Aceptada';
    if (evts.some((e) => e.event_code === '031')) return 'Reclamada';
    if (evts.some((e) => e.event_code === '030')) return 'Acuse';
    return 'Sin acuse';
  }

  canRetry(): boolean {
    const d = this.detail();
    return d?.transmission?.transmission_status !== 'accepted';
  }

  onClose(): void {
    this.isOpen.set(false);
  }

  onPrintPdf(): void {
    const id = this.invoiceId();
    if (!id) return;
    this.printingPdf.set(true);

    const pdfUrl = `${environment.apiUrl}/superadmin/subscriptions/fiscal/sales-invoices/${id}/pdf`;
    window.open(pdfUrl, '_blank');
    this.printingPdf.set(false);
  }

  onDownloadXml(): void {
    const d = this.detail();
    if (!d?.transmission?.request_xml) {
      this.toast.info('XML no disponible para descarga directa');
      return;
    }
    const blob = new Blob([d.transmission.request_xml], { type: 'application/xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.transmission.document_number || 'factura'}.xml`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  openDeliverModal(): void {
    this.isDeliverModalOpen.set(true);
  }

  onConfirmDeliver(): void {
    const id = this.invoiceId();
    const email = this.deliverEmail();
    if (!id || !email) return;

    this.delivering.set(true);
    this.fiscal
      .deliverPlatformInvoice(id, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.delivering.set(false);
          this.isDeliverModalOpen.set(false);
          this.toast.success('Factura enviada por correo', 'Éxito');
        },
        error: (err: any) => {
          this.delivering.set(false);
          this.toast.error(err?.error?.message ?? 'No se pudo enviar el correo', 'Error');
        },
      });
  }

  openRegisterEventModal(): void {
    this.isEventModalOpen.set(true);
  }

  onConfirmEvent(): void {
    const id = this.invoiceId();
    const code = this.selectedEventCode();
    if (!id || !code) return;

    this.registeringEvent.set(true);
    this.fiscal
      .registerPlatformDianEvent(id, { event_code: code })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.registeringEvent.set(false);
          this.isEventModalOpen.set(false);
          this.toast.success('Evento RADIAN registrado', 'Éxito');
          this.loadEvents(id);
          this.invoiceUpdated.emit();
        },
        error: (err: any) => {
          this.registeringEvent.set(false);
          this.toast.error(err?.error?.message ?? 'No se pudo registrar el evento', 'Error');
        },
      });
  }

  onRetryTransmission(): void {
    const d = this.detail();
    const transId = d?.transmission?.id;
    if (!transId) return;

    this.retrying.set(true);
    this.fiscal
      .retryTransmission(transId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retrying.set(false);
          this.toast.success('Reintento enviado a la DIAN', 'Éxito');
          if (this.invoiceId()) this.loadDetail(this.invoiceId()!);
          this.invoiceUpdated.emit();
        },
        error: (err) => {
          this.retrying.set(false);
          this.toast.error(err?.error?.message ?? 'Fallo al reintentar emisión', 'Error');
        },
      });
  }
}
