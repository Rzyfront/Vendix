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
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components';
import type { ItemListCardConfig } from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import {
  CurrencyFormatService,
  CurrencyPipe as VendixCurrencyPipe,
} from '../../../../../../../shared/pipes/currency';
// Las etiquetas y el tono de los cuatro estados fiscales son LA MISMA función
// pura del riel tienda. Se importa —no se copia— para que un enum nuevo del
// backend se traduzca igual en las dos pantallas.
import {
  fiscalStatusCells,
  toneClasses,
  type FiscalStatusCell,
} from '../../../../../store/invoicing/components/invoice-detail/invoice-fiscal-status.util';
// El lector del rechazo de la DIAN también se reusa: `readDianRejection` es lo
// que convierte «error del proveedor» en «FAB10a: Valor del CUFE no está
// calculado correctamente», que es lo único accionable para el operador.
import {
  blockingReasons,
  describeApiFailure,
  formatReason,
  readDianRejection,
  type DianRejectionReason,
} from '../../../../../store/invoicing/utils/invoicing-errors.util';
import type { Invoice } from '../../../../../store/invoicing/interfaces/invoice.interface';
import type { PlatformResolution } from '../../../../subscriptions/interfaces/fiscal-billing.interface';
import type {
  PlatformDianErrorRow,
  PlatformDianEvent,
  PlatformInvoiceDetailPayload,
  PlatformInvoiceDocument,
  PlatformInvoiceKind,
  PlatformInvoiceLine,
  PlatformInvoiceTransmission,
  PlatformInvoiceWithholding,
} from '../../../../subscriptions/interfaces/platform-invoice-document.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import {
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';

/** Una línea ya normalizada para la tabla del modal. */
interface NormalizedLine {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: string;
  tax_amount: number;
  total: number;
}

/** Una retención ya normalizada, con el monto resuelto. */
interface NormalizedWithholding {
  role: string;
  concept_id: number | null;
  base_amount: number;
  rate_pct: string;
  amount: number;
}

@Component({
  selector: 'app-platform-invoice-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    VendixCurrencyPipe,
    AlertBannerComponent,
    ButtonComponent,
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
      } @else if (payload(); as d) {
        <div class="p-6 space-y-6">
          <!-- ── RECHAZO DIAN, REGLA POR REGLA ── -->
          @if (rejectionReasons().length > 0 || plainRejectionMessage()) {
            <div
              role="alert"
              class="rounded-card border border-error bg-error-light p-4 space-y-3"
            >
              <div class="flex items-start gap-2">
                <app-icon name="alert-triangle" [size]="18" class="text-error mt-0.5" />
                <div class="flex-1 min-w-0 space-y-1">
                  <p class="text-sm font-semibold text-error">
                    La DIAN rechazó el documento
                  </p>
                  @if (rejectionReasons().length > 0) {
                    <ul class="space-y-1 text-sm text-error list-disc pl-4">
                      @for (reason of rejectionReasons(); track reason.message) {
                        <li>{{ formatReason(reason) }}</li>
                      }
                    </ul>
                  } @else {
                    <p class="text-sm text-error">{{ plainRejectionMessage() }}</p>
                  }
                </div>
              </div>
              @if (transmission()?.cufe; as cufe) {
                <p class="text-xs text-error font-mono break-all pt-1">CUFE: {{ cufe }}</p>
              }
            </div>
          }

          <!-- ── MATRIZ DE ESTADO FISCAL (3 FASES) ── -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="rounded-card border border-border bg-surface p-3.5 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  1. Transmisión DIAN
                </span>
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  [class]="transmissionStatusBadgeClasses(transmission()?.transmission_status ?? d.invoice.state)"
                >
                  {{ transmissionStatusLabel(transmission()?.transmission_status ?? d.invoice.state) }}
                </span>
              </div>
              <p class="text-xs text-text-secondary truncate">
                {{ documentNumber() ?? 'Sin consecutivo' }}
              </p>
            </div>

            <div class="rounded-card border border-border bg-surface p-3.5 space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  2. Entrega Adquirente
                </span>
                <span
                  class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  [class]="deliveryStatus() === 'delivered' ? 'bg-success-light text-success border-success' : 'bg-warning-light text-warning border-warning'"
                >
                  {{ deliveryStatus() === 'delivered' ? 'Entregada' : 'Pendiente' }}
                </span>
              </div>
              <p class="text-xs text-text-secondary truncate">
                {{ acquirerEmail() ?? 'Sin email registrado' }}
              </p>
            </div>

            <div class="rounded-card border border-border bg-surface p-3.5 space-y-1">
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

          <!-- ── ESTADOS FISCALES CRUDOS (incluye contabilidad) ── -->
          @if (fiscalCells().length > 0) {
            <div class="flex flex-wrap gap-2">
              @for (cell of fiscalCells(); track cell.label) {
                <div
                  class="rounded-card border border-border bg-surface px-3 py-2 space-y-0.5"
                  [title]="cell.hint ?? ''"
                >
                  <p class="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                    {{ cell.label }}
                  </p>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    [class]="toneClasses(cell.tone)"
                  >
                    {{ cell.text }}
                  </span>
                </div>
              }
            </div>
          }

          <!-- ── BARRA DE ACCIONES PRINCIPALES ── -->
          <div class="flex flex-wrap items-center justify-between gap-2 p-3 bg-surface-secondary rounded-card border border-border">
            <div class="flex flex-wrap items-center gap-2">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onOpenPdf()"
                [loading]="loadingPdf()"
                [disabled]="!canUsePlatformActions()"
              >
                <app-icon slot="icon" name="printer" [size]="14"></app-icon>
                Ver / Descargar PDF
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="onPreviewPdf()"
                [loading]="previewingPdf()"
                [disabled]="!canUsePlatformActions()"
              >
                <app-icon slot="icon" name="eye" [size]="14"></app-icon>
                Previsualizar
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="onDownloadXml()"
                [loading]="downloadingXml()"
                [disabled]="!canUsePlatformActions()"
              >
                <app-icon slot="icon" name="code" [size]="14"></app-icon>
                Descargar XML
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                (clicked)="openDeliverModal()"
                [disabled]="!canUsePlatformActions() || !invoiceKeyedActionsAvailable"
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
                [disabled]="
                  !canUsePlatformActions() ||
                  !invoiceKeyedActionsAvailable ||
                  !transmission()?.cufe
                "
              >
                <app-icon slot="icon" name="file-check" [size]="14"></app-icon>
                Registrar Evento
              </app-button>
            </div>
          </div>

          @if (canUsePlatformActions() && !invoiceKeyedActionsAvailable) {
            <app-alert-banner variant="info">
              El reenvío por correo y los eventos RADIAN todavía no están
              habilitados para las facturas emitidas desde la plataforma.
              Mientras tanto, descargue el PDF o el XML y envíelos al adquirente
              por su medio habitual.
            </app-alert-banner>
          }

          @if (!canUsePlatformActions()) {
            <app-alert-banner variant="info">
              Este documento pertenece al riel de facturas de suscripción (SaaS). El
              PDF, el XML, el reenvío por correo y los eventos RADIAN sólo existen
              para las facturas emitidas por la plataforma.
            </app-alert-banner>
          }

          <!-- ── RESUMEN + DESTINATARIO ── -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Datos del documento -->
            <div class="bg-surface rounded-card border border-border p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Información del Documento
              </h3>
              <dl class="grid grid-cols-2 gap-y-2 text-xs">
                <dt class="text-text-secondary">Número</dt>
                <dd class="font-medium text-text-primary">{{ documentNumber() ?? '—' }}</dd>

                <dt class="text-text-secondary">Fecha Emisión</dt>
                <dd class="text-text-primary">
                  {{ (transmission()?.created_at ?? d.invoice.issued_at) | date: 'medium' }}
                </dd>

                <dt class="text-text-secondary">Forma de Pago</dt>
                <dd class="text-text-primary">
                  {{ d.invoice.payment_form === '2' ? 'Crédito' : 'Contado' }}
                </dd>

                @if (d.invoice.due_date) {
                  <dt class="text-text-secondary">Vencimiento</dt>
                  <dd class="text-text-primary">{{ d.invoice.due_date | date: 'mediumDate' }}</dd>
                }
              </dl>

              <!-- CUFE con copia al portapapeles -->
              @if (transmission()?.cufe; as cufe) {
                <div class="pt-2 border-t border-border space-y-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs text-text-secondary">CUFE</span>
                    <app-button variant="ghost" size="sm" (clicked)="onCopyCufe(cufe)">
                      <app-icon
                        slot="icon"
                        [name]="cufeCopied() ? 'check' : 'copy'"
                        [size]="14"
                      ></app-icon>
                      {{ cufeCopied() ? 'Copiado' : 'Copiar' }}
                    </app-button>
                  </div>
                  <p class="font-mono text-[11px] text-text-secondary break-all">{{ cufe }}</p>
                </div>
              }

              <!-- Verificación en el catálogo DIAN -->
              @if (dianCatalogUrl() || qrImageSrc()) {
                <div class="pt-2 border-t border-border flex items-center gap-3">
                  @if (qrImageSrc(); as qrSrc) {
                    <img
                      [src]="qrSrc"
                      alt="Código QR de verificación DIAN"
                      class="h-20 w-20 rounded border border-border bg-surface"
                    />
                  }
                  @if (dianCatalogUrl(); as catalogUrl) {
                    <a
                      [href]="catalogUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <app-icon name="external-link" [size]="14"></app-icon>
                      Verificar en el catálogo de la DIAN
                    </a>
                  }
                </div>
              }
            </div>

            <!-- Datos del Adquirente / Cliente -->
            <div class="bg-surface rounded-card border border-border p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Adquirente / Cliente
              </h3>
              <dl class="grid grid-cols-2 gap-y-2 text-xs">
                <dt class="text-text-secondary">Razón Social</dt>
                <dd class="font-medium text-text-primary">{{ acquirerName() }}</dd>

                <dt class="text-text-secondary">Identificación / NIT</dt>
                <dd class="font-mono text-text-primary">{{ acquirerTaxId() ?? 'Sin NIT' }}</dd>

                <dt class="text-text-secondary">Correo</dt>
                <dd class="text-text-primary truncate">{{ acquirerEmail() ?? '—' }}</dd>

                @if (acquirerAddressLine(); as line) {
                  <dt class="text-text-secondary">Dirección</dt>
                  <dd class="text-text-primary">{{ line }}</dd>
                }
              </dl>
            </div>
          </div>

          <!-- ── RESOLUCIÓN DIAN ── -->
          @if (resolution(); as res) {
            <div class="bg-surface rounded-card border border-border p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Resolución DIAN
              </h3>
              <dl class="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 text-xs">
                <div>
                  <dt class="text-text-secondary">Número</dt>
                  <dd class="font-medium text-text-primary">{{ res.resolution_number ?? '—' }}</dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Prefijo</dt>
                  <dd class="font-mono text-text-primary">{{ res.prefix }}</dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Rango autorizado</dt>
                  <dd class="text-text-primary">{{ res.range_from }} – {{ res.range_to }}</dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Consecutivo consumido</dt>
                  <dd class="text-text-primary">
                    {{ res.current_number }}
                    <span class="text-text-secondary">({{ consumedPercent() }})</span>
                  </dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Fecha de resolución</dt>
                  <dd class="text-text-primary">
                    {{ res.resolution_date ? (res.resolution_date | date: 'mediumDate') : '—' }}
                  </dd>
                </div>
                <div class="col-span-2">
                  <dt class="text-text-secondary">Vigencia</dt>
                  <dd class="text-text-primary">
                    {{ res.valid_from ? (res.valid_from | date: 'mediumDate') : 'Sin inicio' }}
                    →
                    {{ res.valid_to ? (res.valid_to | date: 'mediumDate') : 'Sin vencimiento' }}
                  </dd>
                </div>
                <div>
                  <dt class="text-text-secondary">Estado</dt>
                  <dd>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      [class]="res.is_active ? 'bg-success-light text-success' : 'bg-surface-secondary text-text-secondary'"
                    >
                      {{ res.is_active ? 'Activa' : 'Inactiva' }}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          }

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

          <!-- ── RETENCIONES DETALLADAS ── -->
          @if (withholdings().length > 0) {
            <div class="space-y-2">
              <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Retenciones practicadas ({{ withholdings().length }})
              </h3>
              <app-responsive-data-view
                [data]="withholdings()"
                [columns]="withholdingColumns"
                [cardConfig]="withholdingsCardConfig"
                [loading]="false"
              />
            </div>
          }

          <!-- ── TOTALES MONETARIOS ── -->
          <div class="flex justify-end">
            <div class="w-full md:w-80 bg-surface rounded-card border border-border p-4 space-y-2 text-xs">
              <div class="flex justify-between text-text-secondary">
                <span>Subtotal</span>
                <span class="font-medium text-text-primary">{{ subtotal() | currency }}</span>
              </div>
              @if (discount() > 0) {
                <div class="flex justify-between text-text-secondary">
                  <span>Descuentos</span>
                  <span class="text-error">- {{ discount() | currency }}</span>
                </div>
              }
              <div class="flex justify-between text-text-secondary">
                <span>Impuestos (IVA / INC)</span>
                <span class="font-medium text-text-primary">{{ taxAmount() | currency }}</span>
              </div>
              <div class="pt-2 border-t border-border flex justify-between text-sm font-bold text-text-primary">
                <span>Total del documento</span>
                <span class="text-primary">{{ total() | currency }}</span>
              </div>
              @if (withholdingTotal() > 0) {
                <div class="flex justify-between text-text-secondary pt-1">
                  <span>Retenciones</span>
                  <span class="text-warning">- {{ withholdingTotal() | currency }}</span>
                </div>
                <div class="pt-2 border-t border-border flex justify-between text-sm font-bold text-text-primary">
                  <span>Neto a recaudar</span>
                  <span class="text-primary">{{ netToCollect() | currency }}</span>
                </div>
              }
            </div>
          </div>

          <!-- ── EVENTOS RADIAN TIMELINE ── -->
          <div class="space-y-3 pt-2">
            <h3 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Historial de Eventos RADIAN
            </h3>
            @if (canUsePlatformActions() && !invoiceKeyedActionsAvailable) {
              <p class="text-xs text-text-secondary italic">
                El historial RADIAN aún no está disponible para las facturas
                emitidas desde la plataforma.
              </p>
            } @else if (eventsError(); as evErr) {
              <app-alert-banner variant="warning">{{ evErr }}</app-alert-banner>
            } @else if (events().length === 0) {
              <p class="text-xs text-text-secondary italic">
                No hay eventos registrados para esta factura.
              </p>
            } @else {
              <div class="space-y-2">
                @for (ev of events(); track ev.id) {
                  <div class="flex items-center justify-between p-3 rounded-card border border-border bg-surface text-xs">
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
  /**
   * Qué riel abre el modal. NO es cosmético: decide el endpoint de detalle y,
   * con él, qué espacio de id es `invoiceId`.
   *   · `platform`     → `GET /platform-invoices/:id`, id = `fiscal_transmissions.id`
   *   · `subscription` → `GET /invoices/:id`,          id = `subscription_invoices.id`
   */
  readonly invoiceKind = input<PlatformInvoiceKind>('platform');
  readonly invoiceUpdated = output<void>();
  readonly closed = output<void>();

  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly toast = inject(ToastService);
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly payload = signal<PlatformInvoiceDetailPayload | null>(null);
  readonly lines = signal<NormalizedLine[]>([]);
  readonly withholdings = signal<NormalizedWithholding[]>([]);
  readonly events = signal<PlatformDianEvent[]>([]);
  readonly eventsError = signal<string | null>(null);
  readonly resolution = signal<PlatformResolution | null>(null);

  readonly loadingPdf = signal(false);
  readonly previewingPdf = signal(false);
  readonly retrying = signal(false);
  readonly delivering = signal(false);
  readonly downloadingXml = signal(false);
  readonly registeringEvent = signal(false);
  readonly cufeCopied = signal(false);

  readonly isDeliverModalOpen = signal(false);
  readonly deliverEmail = signal('');

  readonly isEventModalOpen = signal(false);
  readonly selectedEventCode = signal('030');

  /**
   * Reglas que la DIAN nombró en el rechazo. Se alimenta de dos fuentes:
   *   · lo que el payload persiste (`dian_errors[]`), cuando llegue;
   *   · el error EN VIVO de un reintento fallido, leído con
   *     `readDianRejection` — el mismo lector del riel tienda.
   */
  readonly liveRejectionReasons = signal<DianRejectionReason[]>([]);

  readonly transmissionStatusBadgeClasses = transmissionStatusBadgeClasses;
  readonly transmissionStatusLabel = transmissionStatusLabel;
  readonly toneClasses = toneClasses;
  readonly formatReason = formatReason;

  readonly eventOptions = [
    { value: '030', label: '030 - Acuse de recibo de factura electrónica' },
    { value: '031', label: '031 - Reclamo de factura electrónica' },
    { value: '032', label: '032 - Recibo del bien o prestación del servicio' },
    { value: '033', label: '033 - Aceptación expresa' },
  ];

  // ── Derivados del payload ────────────────────────────────────────────────

  readonly document = computed<PlatformInvoiceDocument | null>(
    () => this.payload()?.invoice ?? null,
  );

  readonly transmission = computed<PlatformInvoiceTransmission | null>(
    () => this.payload()?.transmissions?.[0] ?? null,
  );

  /**
   * Id que consumen PDF, XML, reenvío y eventos RADIAN.
   *
   * Es el de la TRANSMISIÓN, no el de la cabecera: `PlatformInvoicePdfService`
   * resuelve por `fiscal_transmissions.id` filtrando
   * `source_type IN (platform_invoice, platform_support_document)`. En el riel
   * plataforma `invoiceId` YA es ese número, pero se lee de la fila devuelta
   * para no depender de esa coincidencia.
   */
  readonly transmissionId = computed<number | null>(
    () => this.transmission()?.id ?? (this.invoiceKind() === 'platform' ? this.invoiceId() : null),
  );

  /**
   * Las acciones documentales existen SÓLO para el riel plataforma. Los tres
   * servicios que las atienden filtran por `source_type` de plataforma o
   * buscan en `invoices` bajo la organización plataforma, así que dispararlas
   * sobre una factura SaaS devuelve 404 —o, peor, resuelve otro documento con
   * el mismo número—. Se apagan y el banner de abajo dice por qué.
   */
  readonly canUsePlatformActions = computed(
    () => this.invoiceKind() === 'platform' && this.transmissionId() !== null,
  );

  /**
   * El reenvío por correo y los eventos RADIAN cuelgan de una fila de
   * `invoices`: `invoice_delivery_events.invoice_id` y
   * `dian_document_events.invoice_id` son FK a esa tabla, y los dos servicios
   * de plataforma abren con `invoices.findFirst({ id, organization_id })`.
   *
   * Una factura del riel plataforma NO crea esa fila: se persiste como
   * `fiscal_transmissions` (`source_type='platform_invoice'`, `source_id: 0`)
   * más sus evidencias, y el id que viaja a la UI es el de la transmisión. Las
   * dos rutas responden 404 por diseño, no por avería — habilitarlas exige una
   * migración que haga `invoice_id` opcional y añada `transmission_id`.
   *
   * Mientras tanto se apagan y se dice por qué: un botón que siempre falla
   * enseña al operador a desconfiar de los que sí funcionan.
   */
  readonly invoiceKeyedActionsAvailable: boolean = false;

  readonly documentNumber = computed<string | null>(
    () =>
      this.transmission()?.document_number ??
      this.document()?.invoice_number ??
      null,
  );

  readonly deliveryStatus = computed<string>(
    () => this.transmission()?.delivery_status ?? 'pending',
  );

  readonly acquirerName = computed<string>(() => {
    const org = this.payload()?.organization;
    const customer = this.document()?.customer;
    return (
      customer?.legal_name ?? org?.legal_name ?? org?.name ?? '—'
    );
  });

  readonly acquirerTaxId = computed<string | null>(() => {
    const customer = this.document()?.customer;
    const org = this.payload()?.organization;
    const taxId = customer?.tax_id ?? org?.tax_id ?? null;
    if (!taxId) return null;
    return customer?.tax_id_dv ? `${taxId}-${customer.tax_id_dv}` : taxId;
  });

  readonly acquirerEmail = computed<string | null>(
    () => this.document()?.customer?.email ?? this.payload()?.organization?.email ?? null,
  );

  readonly acquirerAddressLine = computed<string | null>(() => {
    const address = this.document()?.customer?.address;
    if (!address?.line) return null;
    return address.city ? `${address.line} (${address.city})` : address.line;
  });

  readonly subtotal = computed(() => this.toNumber(this.document()?.subtotal));
  readonly taxAmount = computed(() => this.toNumber(this.document()?.tax_amount));
  readonly total = computed(() => this.toNumber(this.document()?.total));
  readonly discount = computed(
    () =>
      this.toNumber(this.document()?.discount_amount) ||
      this.toNumber(this.document()?.global_discount_amount),
  );

  /**
   * Retenciones del documento. Prefiere la suma del desglose —que es lo que
   * el operador puede auditar línea por línea— y cae al escalar
   * `invoice.withholding_amount` cuando el snapshot no trajo el arreglo.
   */
  readonly withholdingTotal = computed(() => {
    const detailed = this.withholdings().reduce((acc, w) => acc + w.amount, 0);
    return detailed > 0 ? detailed : this.toNumber(this.document()?.withholding_amount);
  });

  /** Lo que la plataforma realmente cobra: total menos lo retenido. */
  readonly netToCollect = computed(() => this.total() - this.withholdingTotal());

  readonly consumedPercent = computed<string>(() => {
    const res = this.resolution();
    if (!res) return '';
    const span = res.range_to - res.range_from + 1;
    if (span <= 0) return '';
    const used = Math.max(0, res.current_number - res.range_from + 1);
    return `${Math.min(100, Math.round((used / span) * 100))}% del rango`;
  });

  /**
   * El tablero de estados fiscales del riel tienda, alimentado con las tres
   * columnas que la transmisión SÍ trae. `accounting_status` viaja en el
   * payload desde `subscription-fiscal.service.ts` y hasta ahora no se pintaba
   * en ninguna parte del riel super-admin.
   *
   * `fiscalStatusCells` pide una `Invoice` entera pero sólo lee cinco campos, y
   * el riel plataforma no tiene fila en `invoices`: se le pasa el subconjunto
   * que existe de verdad en vez de fabricar una factura falsa.
   */
  readonly fiscalCells = computed<FiscalStatusCell[]>(() => {
    const t = this.transmission();
    if (!t) return [];
    const source: Pick<
      Invoice,
      'invoice_type' | 'transmission_status' | 'dian_status' | 'accounting_status'
    > = {
      invoice_type: 'sales_invoice',
      transmission_status: t.transmission_status ?? undefined,
      dian_status: t.dian_status ?? undefined,
      accounting_status: t.accounting_status ?? undefined,
    };
    return fiscalStatusCells(source as Invoice);
  });

  /**
   * Reglas del rechazo, ya filtradas a las bloqueantes. La DIAN mezcla
   * advertencias con errores en la misma lista y una nota al margen no es la
   * causa del rechazo.
   */
  readonly rejectionReasons = computed<DianRejectionReason[]>(() => {
    const live = this.liveRejectionReasons();
    if (live.length > 0) return live;
    return this.readPersistedReasons(this.transmission());
  });

  /**
   * El `error_message` plano, que es lo ÚNICO que hoy manda el backend.
   * Sólo se pinta cuando no hay ni una regla que enumerar.
   */
  readonly plainRejectionMessage = computed<string | null>(() => {
    const t = this.transmission();
    if (!t) return null;
    const rejected =
      t.transmission_status === 'rejected' || t.dian_status === 'rejected';
    if (!rejected && !t.error_message) return null;
    return t.error_message ?? 'Error en la validación del documento fiscal';
  });

  /**
   * El QR sólo se pinta como imagen cuando de verdad puede serlo. El Anexo
   * Técnico define `qr_code` como el TEXTO que se codifica —con espacios y
   * saltos de línea—, no como un PNG: pasárselo a `<img [src]>` produce un
   * recuadro roto y un `ERR_UNKNOWN_URL_SCHEME` en consola.
   */
  readonly qrImageSrc = computed<string | null>(() => {
    const raw = this.transmission()?.qr_code;
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (/\s/.test(value)) return null;
    return /^(data:image\/|https?:\/\/)/i.test(value) ? value : null;
  });

  /**
   * URL de verificación en el catálogo DIAN. Primero se busca dentro del
   * payload del QR (es su última línea y lo único que el adquirente hace con
   * él). Si no está, se reconstruye desde el CUFE — pero el host depende del
   * ambiente y ese dato NO viaja en el detalle, así que se toma de la
   * resolución que numeró el documento. Sin resolución identificada no se
   * inventa el enlace: apuntar al catálogo equivocado devuelve «documento no
   * encontrado», que es peor que no ofrecer nada.
   */
  readonly dianCatalogUrl = computed<string | null>(() => {
    const raw = this.transmission()?.qr_code;
    if (typeof raw === 'string') {
      const match = raw.match(/https?:\/\/[^\s"']+searchqr[^\s"']*/i);
      if (match) return match[0];
    }
    const cufe = this.transmission()?.cufe;
    const environment = this.resolution()?.environment;
    if (!cufe || !environment) return null;
    const host =
      environment === 'production'
        ? 'catalogo-vpfe.dian.gov.co'
        : 'catalogo-vpfe-hab.dian.gov.co';
    return `https://${host}/document/searchqr?documentkey=${cufe}`;
  });

  readonly modalTitle = computed(() => {
    const number = this.documentNumber();
    return number ? `Factura ${number}` : 'Detalle de Factura';
  });

  // ── Tablas ───────────────────────────────────────────────────────────────

  readonly lineColumns: TableColumn[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'quantity', label: 'Cant.', align: 'right' },
    {
      key: 'unit_price',
      label: 'Precio Unit.',
      align: 'right',
      transform: (val) => this.money(val),
    },
    { key: 'tax_rate', label: 'Tarifa IVA', align: 'right' },
    {
      key: 'tax_amount',
      label: 'Impuesto',
      align: 'right',
      transform: (val) => this.money(val),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      transform: (val) => this.money(val),
    },
  ];

  readonly linesCardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'quantity',
    // `subtitleTransform` recibe el ÍTEM completo, no el valor de `subtitleKey`.
    subtitleTransform: (item: NormalizedLine) => `Cant: ${item.quantity}`,
    detailKeys: [
      { key: 'unit_price', label: 'Precio', transform: (val) => this.money(val) },
      { key: 'total', label: 'Total', transform: (val) => this.money(val) },
    ],
  };

  readonly withholdingColumns: TableColumn[] = [
    { key: 'role', label: 'Concepto' },
    { key: 'concept_id', label: 'Id concepto', align: 'right' },
    {
      key: 'base_amount',
      label: 'Base',
      align: 'right',
      transform: (val) => this.money(val),
    },
    { key: 'rate_pct', label: 'Tarifa', align: 'right' },
    {
      key: 'amount',
      label: 'Retenido',
      align: 'right',
      transform: (val) => this.money(val),
    },
  ];

  readonly withholdingsCardConfig: ItemListCardConfig = {
    titleKey: 'role',
    subtitleKey: 'rate_pct',
    detailKeys: [
      { key: 'base_amount', label: 'Base', transform: (val) => this.money(val) },
      { key: 'amount', label: 'Retenido', transform: (val) => this.money(val) },
    ],
  };

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.invoiceId();
      const kind = this.invoiceKind();
      if (open && id) {
        this.loadDetail(id, kind);
      }
    });
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  loadDetail(id: number, kind: PlatformInvoiceKind): void {
    this.loading.set(true);
    this.error.set(null);
    this.liveRejectionReasons.set([]);
    this.eventsError.set(null);

    const request$ =
      kind === 'platform'
        ? this.fiscal.getPlatformInvoice(id)
        : this.fiscal.getSubscriptionInvoice(id);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.applyPayload(data);
        this.loading.set(false);
        const transmissionId = this.transmissionId();
        // No se consulta una ruta que no puede resolver este id: ver
        // `invoiceKeyedActionsAvailable`. Pedirla igual sólo deja un 404 en la
        // consola y un mensaje que culpa a la organización equivocada.
        if (kind === 'platform' && transmissionId && this.invoiceKeyedActionsAvailable) {
          this.loadEvents(transmissionId);
        } else {
          this.events.set([]);
          this.eventsError.set(null);
        }
        this.loadResolution();
      },
      error: (err: unknown) => {
        this.error.set(describeApiFailure(err).message);
        this.loading.set(false);
      },
    });
  }

  private applyPayload(data: PlatformInvoiceDetailPayload): void {
    this.payload.set(data);

    const rawLines = data.invoice?.items ?? data.invoice?.line_items ?? [];
    this.lines.set(rawLines.map((line) => this.normalizeLine(line)));

    const rawWithholdings = data.invoice?.withholdings ?? [];
    this.withholdings.set(
      rawWithholdings.map((row) => this.normalizeWithholding(row)),
    );

    const email = this.acquirerEmail();
    if (email) {
      this.deliverEmail.set(email);
    }
  }

  private normalizeLine(line: PlatformInvoiceLine): NormalizedLine {
    const quantity = this.toNumber(line.quantity) || 1;
    const unitPrice = this.toNumber(line.unit_price ?? line.amount);
    return {
      description: line.description ?? line.concept ?? 'Ítem de suscripción',
      quantity,
      unit_price: unitPrice,
      tax_rate: this.formatLineRate(line),
      tax_amount: this.toNumber(line.tax_amount ?? line.taxes?.[0]?.tax_amount),
      total: line.total != null ? this.toNumber(line.total) : quantity * unitPrice,
    };
  }

  /**
   * Tarifa de la línea, siempre en porcentaje.
   *
   * En el payload conviven DOS unidades y colapsarlas con un `??` pinta
   * «0.19 %» donde va «19 %»:
   *   · `line.tax_rate` — contrato del proveedor (`ProviderInvoiceTax`), que
   *     el riel plataforma emite ya en PORCENTAJE (`'19.00'`).
   *   · `line.taxes[].rate` — snapshot contable, que conserva la FRACCIÓN
   *     (`0.19`) con la que se calculó el impuesto.
   * Se leen por separado, cada una en su unidad; no se adivina por magnitud
   * (un `1` es tan válido como 1 % que como fracción del 100 %).
   *
   * Sin tarifa declarada NO se asume 19 %: inventar la tarifa de un documento
   * fiscal es peor que decir que no vino.
   */
  private formatLineRate(line: PlatformInvoiceLine): string {
    const pct =
      line.tax_rate != null
        ? this.toNumber(line.tax_rate)
        : line.taxes?.[0]?.rate != null
          ? this.toNumber(line.taxes[0].rate) * 100
          : null;
    if (pct === null) {
      return '—';
    }
    // `19` y no `19.00`; `4.5` conserva su decimal.
    return `${Number(pct.toFixed(2))}%`;
  }

  private normalizeWithholding(
    row: PlatformInvoiceWithholding,
  ): NormalizedWithholding {
    const base = this.toNumber(row.base_amount);
    const rate = this.toNumber(row.rate);
    return {
      role: row.role ?? 'Retención',
      concept_id: row.concept_id ?? null,
      base_amount: base,
      rate_pct: `${(rate * 100).toFixed(2)}%`,
      amount: row.amount != null ? this.toNumber(row.amount) : base * rate,
    };
  }

  loadEvents(transmissionId: number): void {
    this.fiscal
      .listPlatformDianEvents(transmissionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (events) => {
          this.events.set(events ?? []);
          this.eventsError.set(null);
        },
        error: (err: unknown) => {
          this.events.set([]);
          // Silenciar el fallo pintaba «0 eventos registrados», que es una
          // afirmación distinta de «no se pudieron consultar».
          this.eventsError.set(
            `No se pudieron consultar los eventos RADIAN: ${describeApiFailure(err).message}`,
          );
        },
      });
  }

  /**
   * Identifica la resolución que numeró el documento por su PREFIJO.
   *
   * El payload del detalle no dice cuál resolución se usó, así que la única
   * forma honesta de resolverlo es cotejar el prefijo del consecutivo contra
   * las resoluciones registradas. Si ninguna coincide, no se pinta el bloque:
   * mostrar «la resolución activa» sería adivinar, y un documento viejo pudo
   * numerarse con otra.
   */
  loadResolution(): void {
    const documentNumber = this.documentNumber();
    if (!documentNumber) {
      this.resolution.set(null);
      return;
    }
    this.fiscal
      .listResolutions({ document_type: 'sales_invoice' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          const match = rows
            .filter((row) => row.prefix && documentNumber.startsWith(row.prefix))
            // Con varias del mismo prefijo gana la que contiene el consecutivo.
            .sort((a, b) => b.prefix.length - a.prefix.length)[0];
          this.resolution.set(match ?? null);
        },
        error: () => this.resolution.set(null),
      });
  }

  // ── Lectura del rechazo persistido ───────────────────────────────────────

  /**
   * Lee las reglas del rechazo de las dos formas en que el backend PODRÍA
   * mandarlas. Hoy no manda ninguna —los dos endpoints de detalle sólo
   * seleccionan `error_message`—, así que esto queda inerte hasta que el
   * contrato lo incluya; se escribe igual para que el día que llegue el panel
   * ya lo enumere, y para dejar declarado qué falta.
   */
  private readPersistedReasons(
    transmission: PlatformInvoiceTransmission | null,
  ): DianRejectionReason[] {
    const raw =
      transmission?.dian_errors ??
      transmission?.provider_response?.provider_data?.dian_errors ??
      null;
    if (!Array.isArray(raw)) return [];
    return raw.reduce<DianRejectionReason[]>((acc, row: PlatformDianErrorRow) => {
      const message = typeof row?.message === 'string' ? row.message.trim() : '';
      // Un motivo sin letras («0») no le dice nada a nadie y ensucia la lista.
      if (!message || !/\p{L}/u.test(message)) return acc;
      const reason: DianRejectionReason = { message };
      if (row.code) reason.code = row.code;
      if (row.severity) reason.severity = row.severity;
      acc.push(reason);
      return acc;
    }, []);
  }

  // ── Estado RADIAN ────────────────────────────────────────────────────────

  readonly radianStatusClass = computed<string>(() => {
    const events = this.events();
    if (events.some((e) => e.event_code === '033' && e.status === 'accepted')) {
      return 'bg-success-light text-success border-success';
    }
    if (events.some((e) => e.event_code === '031')) {
      return 'bg-error-light text-error border-error';
    }
    return 'bg-surface-secondary text-text-secondary border-border';
  });

  readonly radianStatusLabel = computed<string>(() => {
    const events = this.events();
    if (events.some((e) => e.event_code === '033' && e.status === 'accepted')) {
      return 'Aceptada';
    }
    if (events.some((e) => e.event_code === '031')) return 'Reclamada';
    if (events.some((e) => e.event_code === '030')) return 'Acuse';
    return 'Sin acuse';
  });

  readonly canRetry = computed<boolean>(
    () => this.transmission()?.transmission_status !== 'accepted',
  );

  onClose(): void {
    this.isOpen.set(false);
    this.closed.emit();
  }

  // ── Acciones documentales ────────────────────────────────────────────────

  onCopyCufe(cufe: string): void {
    navigator.clipboard.writeText(cufe).then(
      () => {
        this.cufeCopied.set(true);
        setTimeout(() => this.cufeCopied.set(false), 2000);
      },
      () => this.toast.error('No se pudo copiar el CUFE', 'Portapapeles'),
    );
  }

  /**
   * PDF persistido: el endpoint devuelve `{ key, url }` con una URL FIRMADA de
   * S3, no un binario. Se abre esa URL. Pedirlo como blob devolvería el JSON
   * del envelope disfrazado de archivo.
   */
  onOpenPdf(): void {
    const id = this.transmissionId();
    if (!id) return;
    this.loadingPdf.set(true);
    this.fiscal
      .getPlatformInvoicePdf(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (location) => {
          this.loadingPdf.set(false);
          if (!location?.url) {
            this.toast.warning(
              'El documento todavía no tiene PDF generado.',
              'PDF',
            );
            return;
          }
          window.open(location.url, '_blank', 'noopener');
        },
        error: (err: unknown) => {
          this.loadingPdf.set(false);
          this.toast.error(describeApiFailure(err).message, 'PDF');
        },
      });
  }

  /**
   * Previsualización: este endpoint SÍ responde `application/pdf` en crudo, así
   * que se pide como blob y se abre con una URL de objeto. Leer `res.success`
   * sobre un `Blob` es siempre `undefined` — ese era el bug que dejaba el
   * botón sin abrir nada.
   */
  onPreviewPdf(): void {
    const id = this.transmissionId();
    if (!id) return;
    this.previewingPdf.set(true);
    this.fiscal
      .previewPlatformInvoicePdf(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.previewingPdf.set(false);
          this.openBlobInNewTab(blob, 'application/pdf');
        },
        error: (err: unknown) => {
          this.previewingPdf.set(false);
          this.toast.error(describeApiFailure(err).message, 'Previsualización');
        },
      });
  }

  /**
   * XML firmado. Se PIDE al backend por su propia ruta
   * (`GET platform-invoices/:id/xml`) en vez de esperarlo dentro del payload
   * del detalle: el documento pesa entre 100 y 500 KB y los dos `select` de
   * detalle lo excluyen a propósito para no pagar ese peso en cada apertura
   * del modal.
   *
   * El botón anterior colgaba de `transmission.request_xml`, un campo que no
   * existe en el modelo, así que descargaba `undefined`. Si el payload YA
   * trae el XML (el listado sí lo trae, porque usa `include`), se guarda sin
   * viajar; el HTTP es el camino de respaldo, no el primero.
   */
  onDownloadXml(): void {
    const transmission = this.transmission();
    if (!transmission) return;

    const filename = `${this.documentNumber() ?? `documento-${transmission.id}`}.xml`;

    const inPayload = transmission.xml_document;
    if (inPayload && inPayload.trim()) {
      this.fiscal.saveXmlDocument(inPayload, filename);
      return;
    }

    this.downloadingXml.set(true);
    this.fiscal
      .getPlatformInvoiceXml(transmission.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (xml) => {
          this.downloadingXml.set(false);
          if (!xml || !xml.trim()) {
            this.toast.warning(
              'El servidor devolvió un XML vacío.',
              'XML no disponible',
            );
            return;
          }
          this.fiscal.saveXmlDocument(xml, filename);
        },
        error: (err: unknown) => {
          this.downloadingXml.set(false);
          // Un 404 acá NO es «no existe la factura»: es «esta transmisión
          // todavía no tiene XML firmado» (encolada, o error antes de firmar),
          // y el operador necesita esa distinción para saber si esperar o
          // reintentar.
          this.toast.error(
            parseApiError(err).userMessage ||
              'La factura aún no tiene XML firmado.',
            'XML no disponible',
          );
        },
      });
  }

  openDeliverModal(): void {
    this.isDeliverModalOpen.set(true);
  }

  onConfirmDeliver(): void {
    const id = this.transmissionId();
    const email = this.deliverEmail().trim();
    if (!id || !email) return;

    this.delivering.set(true);
    this.fiscal
      .deliverPlatformInvoice(id, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          this.delivering.set(false);
          this.isDeliverModalOpen.set(false);
          this.toast.success(
            receipt?.zip_name
              ? `Factura encolada hacia ${email} (${receipt.zip_name})`
              : `Factura encolada hacia ${email}`,
            'Reenvío',
          );
        },
        error: (err: unknown) => {
          this.delivering.set(false);
          this.toast.error(describeApiFailure(err).message, 'Reenvío');
        },
      });
  }

  openRegisterEventModal(): void {
    this.isEventModalOpen.set(true);
  }

  onConfirmEvent(): void {
    const id = this.transmissionId();
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
          this.toast.success('Evento RADIAN registrado', 'RADIAN');
          this.loadEvents(id);
          this.invoiceUpdated.emit();
        },
        error: (err: unknown) => {
          this.registeringEvent.set(false);
          this.toast.error(describeApiFailure(err).message, 'RADIAN');
        },
      });
  }

  onRetryTransmission(): void {
    const transmissionId = this.transmission()?.id;
    if (!transmissionId) return;

    this.retrying.set(true);
    this.fiscal
      .retryTransmission(transmissionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.retrying.set(false);
          this.liveRejectionReasons.set([]);
          this.toast.success('Reintento enviado a la DIAN', 'Facturación');
          const id = this.invoiceId();
          if (id) this.loadDetail(id, this.invoiceKind());
          this.invoiceUpdated.emit();
        },
        error: (err: unknown) => {
          this.retrying.set(false);
          const failure = describeApiFailure(err);
          // Un rechazo de la DIAN trae las reglas violadas en
          // `details.dian_errors[]`. Pintar sólo el copy del código dejaría al
          // operador sin nada que corregir.
          const rejection = readDianRejection(failure);
          if (rejection) {
            this.liveRejectionReasons.set(blockingReasons(rejection));
          }
          this.toast.error(failure.message, 'Facturación');
        },
      });
  }

  // ── Utilidades ───────────────────────────────────────────────────────────

  private money(value: unknown): string {
    return this.currencyFormat.format(this.toNumber(value));
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    return Number(value) || 0;
  }

  private openBlobInNewTab(blob: Blob, type: string): void {
    const url = URL.createObjectURL(new Blob([blob], { type }));
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) {
      this.toast.warning(
        'El navegador bloqueó la ventana emergente con la previsualización.',
        'Previsualización',
      );
    }
    // La URL de objeto se revoca al final del ciclo para no filtrar memoria;
    // el navegador ya cargó el documento en la pestaña nueva.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
