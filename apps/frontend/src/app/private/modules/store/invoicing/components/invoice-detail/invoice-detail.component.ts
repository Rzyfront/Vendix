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
  untracked,
} from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  DianDocumentEvent,
  Invoice,
  InvoiceItem,
  InvoiceTax,
} from '../../interfaces/invoice.interface';
import { InvoicingService } from '../../services/invoicing.service';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import {
  selectCurrentInvoice,
  selectDianEvents,
  selectDianEventsInvoiceId,
  selectDianEventsLoading,
  selectDianRejection,
  selectPdfRegenerating,
} from '../../state/selectors/invoicing.selectors';
import {
  DianRejection,
  DianRejectionReason,
  describeApiFailure,
  formatReason,
  readPersistedDianRejection,
} from '../../utils/invoicing-errors.util';
import {
  ContingencyWindow,
  FiscalStatusCell,
  dianEventLabel,
  dianEventStatusLabel,
  dianEventStatusTone,
  fiscalStatusCells,
  readContingency,
  retryStatusLabel,
  retryStatusTone,
  toneClasses,
} from './invoice-fiscal-status.util';
import { DianEventRegisterModalComponent } from './dian-event-register-modal.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoice-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    DianEventRegisterModalComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (cancel)="onClose()"
      [title]="detail() ? 'Factura ' + detail()!.invoice_number : 'Detalle de Factura'"
      size="xl"
      >
      @if (detail(); as inv) {
        <div class="p-4">
          <!-- ── RECHAZO DE LA DIAN ────────────────────────────────────────
               Aqui, y no en un toast: dian_errors[] puede traer N reglas
               («FAB10a: Valor del CUFE no esta calculado correctamente»), y
               esas son las que el comerciante tiene que corregir. Un toast de
               dos segundos las tira a la basura igual que el catchError vacio
               que este trabajo vino a arreglar. El panel vive junto al boton
               "Enviar" que produjo el rechazo y sobrevive hasta el reintento.

               Y SOBREVIVE A LA RECARGA: rejection() cae a la evidencia
               persistida en provider_response cuando el error en vivo ya no
               esta. Antes, recargar borraba los motivos y dejaba el badge de
               rechazo solo, sin nada que corregir.
          -->
          @if (rejection(); as rej) {
            <div
              role="alert"
              class="mb-4 rounded-lg border border-error bg-error-light p-3 space-y-2"
            >
              <div class="flex items-start gap-2">
                <app-icon name="alert-triangle" [size]="16" class="text-error" />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-error">La DIAN rechazó el documento</p>
                  <p class="text-sm text-error">{{ rej.headline }}</p>
                </div>
              </div>

              @if (rej.reasons.length) {
                <ul class="list-disc pl-6 space-y-1">
                  @for (reason of rej.reasons; track reason.message) {
                    <li class="text-sm text-error">
                      {{ describeReason(reason) }}
                      @if (reason.severity === 'warning') {
                        <span class="ml-1 text-xs opacity-70">(advertencia)</span>
                      }
                    </li>
                  }
                </ul>
              }

              @if (rej.statusDescription || rej.statusCode) {
                <p class="text-xs text-error">
                  Estado DIAN:
                  {{ rej.statusDescription || rej.statusCode }}
                  @if (rej.statusDescription && rej.statusCode) {
                    <span> ({{ rej.statusCode }})</span>
                  }
                </p>
              }
              @if (rej.trackingId) {
                <p class="text-xs text-error break-all">
                  Tracking DIAN: <code>{{ rej.trackingId }}</code>
                </p>
              }
            </div>
          }

          <!-- ── CONTINGENCIA Y SU PLAZO DE 48 H ───────────────────────────
               Anexo Tecnico 1.9 §12.2: cuando la DIAN no responde, el documento
               se ENTREGA al adquiriente sin validacion previa y queda debiendo
               su transmision dentro de 48 h. Sin este bloque la factura se veia
               exactamente igual que una que nadie envio nunca — y el reloj
               corriendo era invisible.

               El vencimiento NO se calcula aqui: «contingency_deadline» lo
               persiste el backend, que es quien sabe que las 48 h corren desde
               la PRIMERA declaracion y no desde el ultimo reintento.
          -->
          @if (contingency(); as cont) {
            <div
              role="status"
              class="mb-4 rounded-lg border p-3 space-y-2"
              [ngClass]="cont.expired
                ? 'border-error bg-error-light'
                : 'border-warning bg-warning-light'"
            >
              <div class="flex items-start gap-2">
                <app-icon
                  name="clock"
                  [size]="16"
                  [ngClass]="cont.expired ? 'text-error' : 'text-warning'"
                />
                <div class="flex-1 min-w-0">
                  <p
                    class="text-sm font-semibold"
                    [ngClass]="cont.expired ? 'text-error' : 'text-warning'"
                  >
                    Documento expedido en contingencia — {{ cont.typeLabel }}
                  </p>
                  <p class="text-sm" [ngClass]="cont.expired ? 'text-error' : 'text-warning'">
                    Se entregó al adquiriente sin validación previa de la DIAN y debe
                    transmitirse dentro de las 48 horas siguientes.
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                @if (cont.declaredAt) {
                  <div [ngClass]="cont.expired ? 'text-error' : 'text-warning'">
                    Declarada: {{ cont.declaredAt | date:'dd/MM/yyyy HH:mm' }}
                  </div>
                }
                @if (cont.deadline) {
                  <div [ngClass]="cont.expired ? 'text-error' : 'text-warning'">
                    Vence: {{ cont.deadline | date:'dd/MM/yyyy HH:mm' }}
                  </div>
                }
              </div>

              @if (cont.countdown) {
                <p
                  class="text-sm font-semibold"
                  [ngClass]="cont.expired ? 'text-error' : 'text-warning'"
                >
                  {{ cont.countdown }}
                </p>
              } @else {
                <!-- Sin «contingency_deadline» no se inventa la cuenta: el plazo
                     legal no puede salir de una resta hecha en el navegador. -->
                <p class="text-xs" [ngClass]="cont.expired ? 'text-error' : 'text-warning'">
                  El backend no registró la fecha límite de este documento; consulta el
                  plazo con soporte antes de asumir que sigue vigente.
                </p>
              }

              @if (cont.reason) {
                <p class="text-xs break-words" [ngClass]="cont.expired ? 'text-error' : 'text-warning'">
                  Motivo: {{ cont.reason }}
                </p>
              }
            </div>
          }

          <!-- Status & Type Banner -->
          <div class="flex items-center justify-between mb-4 p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-border">
            <div class="flex items-center gap-2">
              <span class="text-sm text-text-secondary">Tipo:</span>
              <span class="text-sm font-medium text-text-primary">{{ getTypeLabel(inv.invoice_type) }}</span>
            </div>
            <span
              class="px-2.5 py-1 text-xs font-medium rounded-full"
              [ngClass]="getStatusClasses(inv.status)"
              >
              {{ getStatusLabel(inv.status) }}
            </span>
          </div>

          <!-- ── LOS TRES ESTADOS FISCALES ─────────────────────────────────
               «status» no es el unico estado de una factura: la fila lleva
               ademas «transmission_status«, «dian_status« y «accounting_status«,
               y cada uno responde una pregunta distinta. Antes solo se pintaba
               «status» y se escupia «send_status« en crudo («sent_error»), asi
               que «la DIAN no lo ha juzgado» y «el asiento esta bloqueado» eran
               indistinguibles desde la pantalla.
          -->
          @if (fiscalCells().length) {
            <div class="mb-4">
              <h4 class="text-sm font-semibold text-text-primary mb-2">Estado fiscal</h4>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                @for (cell of fiscalCells(); track cell.label) {
                  <div class="p-2 rounded-lg border border-border bg-[var(--color-surface-secondary)]">
                    <p class="text-xs text-text-secondary mb-1">{{ cell.label }}</p>
                    <span
                      class="inline-block px-2 py-0.5 text-xs font-medium rounded-full"
                      [ngClass]="tone(cell.tone)"
                      >{{ cell.text }}</span
                    >
                    @if (cell.hint) {
                      <p class="mt-1 text-[11px] leading-tight text-text-secondary">{{ cell.hint }}</p>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- ── COLA DE REINTENTOS ────────────────────────────────────────
               «retry_status« viene de «invoice_retry_queue« y HOY lo adjuntan LOS
               DOS endpoints: «findAll« y «findOne« de invoicing.service.ts
               aplican el MISMO criterio de elegibilidad
               (RETRY_ELIGIBLE_SEND_STATUSES ∪ RETRY_ELIGIBLE_TRANSMISSION_STATUSES).
               Acá decía lo contrario —«sólo la lista lo trae»— y era falso: se
               verificó releyendo «findOne«. Una nota caducada sobre de dónde sale
               un dato es justo la que hace que el próximo lector conserve un
               apaño que ya no hace falta.

               Ausente NO significa «no vino»: significa «esta factura no es
               candidata a reintento». Por eso el panel se pinta sobre la
               presencia del objeto y nunca sobre la de la clave.
          -->
          @if (inv.retry_status; as retry) {
            <div class="mb-4 p-3 rounded-lg border border-border bg-[var(--color-surface-secondary)] space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <app-icon name="refresh-cw" [size]="14" class="text-text-secondary" />
                  <h4 class="text-sm font-semibold text-text-primary">Reintentos automáticos</h4>
                </div>
                <span
                  class="px-2 py-0.5 text-xs font-medium rounded-full"
                  [ngClass]="tone(retryTone(retry.status))"
                  >{{ retryLabel(retry.status) }}</span
                >
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-text-secondary">
                <div>Intentos: {{ retry.attempts }} de {{ retry.max_attempts }}</div>
                @if (retry.next_retry_at) {
                  <div>Próximo intento: {{ retry.next_retry_at | date:'dd/MM/yyyy HH:mm' }}</div>
                }
              </div>
              @if (retry.last_error) {
                <p class="text-xs text-error break-words">Último error: {{ retry.last_error }}</p>
              }
            </div>
          }

          <!-- Customer Info -->
          <div class="mb-4 space-y-2">
            <h4 class="text-sm font-semibold text-text-primary">Datos del Cliente</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <span class="text-text-secondary">Nombre:</span>
                <span class="ml-1 text-text-primary">{{ inv.customer_name || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">NIT/Cédula:</span>
                <span class="ml-1 text-text-primary">{{ inv.customer_tax_id || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Correo Electrónico:</span>
                <span class="ml-1 text-text-primary">{{ inv.customer_email || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Teléfono:</span>
                <span class="ml-1 text-text-primary">{{ inv.customer_phone || '-' }}</span>
              </div>
            </div>
          </div>
          <!-- Dates -->
          <div class="mb-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span class="text-text-secondary">Fecha Emisión:</span>
              <span class="ml-1 text-text-primary">{{ inv.issue_date | date:'dd/MM/yyyy':'UTC' }}</span>
            </div>
            <div>
              <span class="text-text-secondary">Fecha Vencimiento:</span>
              <span class="ml-1 text-text-primary">{{ inv.due_date ? (inv.due_date | date:'dd/MM/yyyy':'UTC') : '-' }}</span>
            </div>
          </div>
          <!-- Resolution.
               Se pintan prefijo, numero y rango — NUNCA «technical_key«. La
               ClTec es el secreto con el que se calcula el CUFE: el backend la
               manda dentro de «resolution« porque hace «include« sin «select«,
               pero mostrarla en pantalla la publica a cualquiera que abra una
               factura. -->
          @if (inv.resolution) {
            <div class="mb-4 text-sm p-2 bg-[var(--color-info-light)] rounded-lg">
              <span class="text-[var(--color-info)] font-medium">Resolución:</span>
              <span class="ml-1 text-[var(--color-info)]">
                {{ inv.resolution?.prefix }} {{ inv.resolution?.resolution_number }}
                ({{ inv.resolution?.range_from }} - {{ inv.resolution?.range_to }})
              </span>
            </div>
          }
          <!-- Items Table -->
          <div class="mb-4">
            <h4 class="text-sm font-semibold text-text-primary mb-2">Productos / Servicios</h4>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-2 px-2 text-text-secondary font-medium">Producto</th>
                    <th class="text-center py-2 px-2 text-text-secondary font-medium">Cant.</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Precio</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Desc.</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">IVA</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of lines(); track item.id) {
                    <tr class="border-b border-border">
                      <td class="py-2 px-2 text-text-primary">
                        <span>{{ item.product_name || item.description }}</span>
                        @if (item.applied_price_tier_name) {
                          <span class="block text-xs text-text-secondary">Tarifa: {{ item.applied_price_tier_name }}</span>
                        }
                        @if (isPackageLine(item)) {
                          <span class="block text-xs text-text-secondary">
                            {{ item.quantity }} paq. = {{ item.stock_units_consumed }} u. (×{{ packagePerUnit(item) }})
                          </span>
                        }
                      </td>
                      <td class="py-2 px-2 text-center text-text-primary">{{ item.quantity }}</td>
                      <td class="py-2 px-2 text-right text-text-primary">{{ formatCurrency(item.unit_price) }}</td>
                      <td class="py-2 px-2 text-right text-text-secondary">{{ formatCurrency(item.discount_amount) }}</td>
                      <td class="py-2 px-2 text-right text-text-secondary">{{ formatCurrency(item.tax_amount) }}</td>
                      <td class="py-2 px-2 text-right font-medium text-text-primary">{{ formatCurrency(item.total_amount) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="py-4 text-center text-text-secondary">Sin productos</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <!-- Taxes Summary -->
          @if (taxLines().length) {
            <div class="mb-4">
              <h4 class="text-sm font-semibold text-text-primary mb-2">Impuestos</h4>
              <div class="space-y-1">
                @for (tax of taxLines(); track tax.id) {
                  <div class="flex justify-between text-sm">
                    <span class="text-text-secondary">{{ tax.tax_name }} ({{ tax.tax_rate }}%)</span>
                    <span class="text-text-primary">{{ formatCurrency(tax.tax_amount) }}</span>
                  </div>
                }
              </div>
            </div>
          }
          <!-- Totals -->
          <div class="border-t border-border pt-3 space-y-1">
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Subtotal</span>
              <span class="text-text-primary">{{ formatCurrency(inv.subtotal_amount) }}</span>
            </div>
            @if (inv.discount_amount > 0) {
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Descuentos</span>
                <span class="text-error">-{{ formatCurrency(inv.discount_amount) }}</span>
              </div>
            }
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Impuestos</span>
              <span class="text-text-primary">{{ formatCurrency(inv.tax_amount) }}</span>
            </div>
            @if (inv.withholding_amount > 0) {
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Retenciones</span>
                <span class="text-error">-{{ formatCurrency(inv.withholding_amount) }}</span>
              </div>
            }
            <div class="flex justify-between text-base font-semibold pt-2 border-t border-border">
              <span class="text-text-primary">Total</span>
              <span class="text-primary">{{ formatCurrency(inv.total_amount) }}</span>
            </div>
          </div>
          <!-- Notes -->
          @if (inv.notes) {
            <div class="mt-4 p-3 bg-[var(--color-surface-secondary)] rounded-lg">
              <h4 class="text-sm font-semibold text-text-primary mb-1">Notas</h4>
              <p class="text-sm text-text-secondary">{{ inv.notes }}</p>
            </div>
          }
          <!-- DIAN Details (CUFE/QR) -->
          @if (inv.cufe || inv.qr_code) {
            <div class="mt-4 p-3 bg-success-light rounded-lg space-y-3">
              <h4 class="text-sm font-semibold text-success">Información DIAN</h4>
              @if (inv.cufe) {
                <div class="flex items-center gap-2">
                  <span class="text-xs text-success font-medium">CUFE:</span>
                  <code class="text-xs text-success bg-success-light px-2 py-0.5 rounded break-all flex-1">{{ inv.cufe }}</code>
                  <app-button variant="ghost" size="sm" (clicked)="copyCufe()">
                    <app-icon slot="icon" name="copy" [size]="12"></app-icon>
                  </app-button>
                </div>
              }
              @if (inv.qr_code) {
                <div class="text-center">
                  <img [src]="inv.qr_code" alt="QR Code DIAN" class="w-32 h-32 mx-auto border border-success rounded" />
                </div>
              }
            </div>
          }

          <!-- ── DOCUMENTOS DESCARGABLES ───────────────────────────────────
               El PDF NO se abre desde «inv.pdf_url«: esa columna guarda la
               LLAVE S3, no una URL («invoice-pdf.service.ts« persiste
               «stores/…/invoice-XXX.pdf«). Abrirla directo producia una ruta
               relativa rota. «GET :id/pdf« es el que la firma.

               El XML se arma en el cliente con «xml_document«, que ya viaja en
               el payload: no existe endpoint de descarga de XML en el backend.
          -->
          <div class="mt-4 p-3 rounded-lg border border-border bg-[var(--color-surface-secondary)]">
            <h4 class="text-sm font-semibold text-text-primary mb-2">Documentos</h4>
            <div class="flex flex-wrap items-center gap-2">
              <app-button
                variant="outline"
                size="sm"
                [loading]="pdfLoading()"
                (clicked)="downloadPdf()">
                <app-icon slot="icon" name="download" [size]="14"></app-icon>
                Descargar PDF
              </app-button>

              <app-button
                variant="outline"
                size="sm"
                [loading]="pdfRegenerating()"
                (clicked)="regeneratePdf()">
                <app-icon slot="icon" name="rotate-cw" [size]="14"></app-icon>
                Regenerar PDF
              </app-button>

              @if (inv.xml_document) {
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="downloadXml()">
                  <app-icon slot="icon" name="file-text" [size]="14"></app-icon>
                  Descargar XML
                </app-button>
              }
            </div>
            @if (!inv.xml_document) {
              <p class="mt-2 text-xs text-text-secondary">
                Este documento todavía no tiene XML firmado: el XML sólo existe después
                de transmitirlo a la DIAN.
              </p>
            }
          </div>

          <!-- ── EVENTOS RADIAN (Res. 000085/2022) ─────────────────────────
               «GET /store/invoicing/:id/events« existia en el backend y no
               tenia UN solo cliente: la pista de auditoria del titulo valor
               —acuse, recibo, aceptacion, endoso, pago— no se podia ver desde
               el panel. Se cargan solo cuando hay CUFE porque un evento
               referencia el documento POR su CUFE dentro del catalogo DIAN:
               sin CUFE la lista siempre esta vacia y la llamada sobra.
          -->
          @if (inv.cufe) {
            <div class="mt-4 p-3 rounded-lg border border-border">
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-2">
                  <app-icon name="history" [size]="14" class="text-text-secondary" />
                  <h4 class="text-sm font-semibold text-text-primary">Eventos RADIAN</h4>
                </div>
                <div class="flex items-center gap-1">
                  <!-- Registrar sólo con la factura ACEPTADA: un evento
                       referencia el documento por su CUFE dentro del catálogo
                       DIAN, y sobre un documento no aceptado el backend rechaza
                       con DIAN_EVENT_001. Ofrecer el botón antes sería ofrecer
                       un error. -->
                  @if (inv.status === 'accepted') {
                    <app-button
                      variant="ghost"
                      size="sm"
                      (clicked)="openEventModal()">
                      <app-icon slot="icon" name="plus" [size]="12"></app-icon>
                      Registrar
                    </app-button>
                  }
                  <app-button
                    variant="ghost"
                    size="sm"
                    [loading]="eventsLoading()"
                    (clicked)="reloadEvents()">
                    <app-icon slot="icon" name="refresh-cw" [size]="12"></app-icon>
                  </app-button>
                </div>
              </div>

              @if (eventsLoading()) {
                <p class="text-sm text-text-secondary">Cargando eventos…</p>
              } @else {
                <ol class="space-y-2">
                  @for (event of events(); track event.id) {
                    <li class="border-l-2 border-border pl-3 py-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium text-text-primary">
                          {{ event.event_code }} · {{ eventLabel(event.event_code) }}
                        </span>
                        <span
                          class="px-2 py-0.5 text-[11px] font-medium rounded-full"
                          [ngClass]="tone(eventTone(event.status))"
                          >{{ eventStatus(event.status) }}</span
                        >
                      </div>
                      <p class="text-xs text-text-secondary">
                        {{ (event.issued_at || event.created_at) | date:'dd/MM/yyyy HH:mm' }}
                        @if (event.event_number) {
                          <span> · N° {{ event.event_number }}</span>
                        }
                      </p>
                      @if (event.dian_status_message) {
                        <p class="text-xs text-text-secondary break-words">
                          {{ event.dian_status_code ? event.dian_status_code + ': ' : '' }}{{ event.dian_status_message }}
                        </p>
                      }
                      @if (event.cude) {
                        <p class="text-[11px] text-text-secondary break-all">CUDE: {{ event.cude }}</p>
                      }
                    </li>
                  } @empty {
                    <li class="text-sm text-text-secondary">
                      Este documento no tiene eventos RADIAN registrados.
                    </li>
                  }
                </ol>
              }
            </div>
          }

          <!-- Cross-module Links -->
          @if (inv.order_id) {
            <div class="mt-4">
              <a class="text-sm text-primary hover:underline cursor-pointer" (click)="navigateToOrder()">
                <app-icon name="external-link" [size]="12"></app-icon>
                Ver Orden Asociada
              </a>
            </div>
          }
        </div>
      }

      <!-- Footer with actions -->
      <div slot="footer">
        <div class="flex items-center justify-between gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border">
          <div class="flex flex-wrap items-center gap-2">
            @if (canValidate()) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onValidate()">
                <app-icon slot="icon" name="check" [size]="14"></app-icon>
                Validar
              </app-button>
            }
            @if (canSend()) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onSend()">
                <app-icon slot="icon" name="send" [size]="14"></app-icon>
                {{ sendLabel() }}
              </app-button>
            }
            <!-- REENVIAR. No hay endpoint de "resend": el reenvio es el MISMO
                 «PATCH :id/send«, y la tabla de transiciones del backend
                 («VALID_TRANSITIONS«) lo autoriza expresamente desde
                 «rejected« («rejected: ['sent', 'voided']«). Un boton aparte
                 apuntando a otra ruta seria una ruta inventada. -->
            @if (canResend()) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onSend()">
                <app-icon slot="icon" name="refresh-cw" [size]="14"></app-icon>
                Reenviar a la DIAN
              </app-button>
            }
            @if (canCreateCreditNote()) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="creditNote.emit(detail()!)">
                <app-icon slot="icon" name="file-minus" [size]="14"></app-icon>
                Nota Crédito
              </app-button>
            }
            @if (canAccept()) {
              <app-button
                variant="primary"
                size="sm"
                (clicked)="onAccept()">
                <app-icon slot="icon" name="check-circle" [size]="14"></app-icon>
                Aceptar
              </app-button>
            }
            @if (canReject()) {
              <app-button
                variant="outline-danger"
                size="sm"
                (clicked)="onReject()">
                <app-icon slot="icon" name="x-circle" [size]="14"></app-icon>
                Rechazar
              </app-button>
            }
            @if (canCancel()) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onCancel()">
                <app-icon slot="icon" name="slash" [size]="14"></app-icon>
                Cancelar
              </app-button>
            }
            @if (canVoid()) {
              <app-button
                variant="outline-danger"
                size="sm"
                (clicked)="onVoid()">
                <app-icon slot="icon" name="trash-2" [size]="14"></app-icon>
                Anular
              </app-button>
            }
          </div>

          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>

    <!-- HERMANO del modal de detalle, no hijo. Metido dentro del cuerpo del
         detalle, el desplegable del selector —posicionado absoluto— quedaría
         recortado por el «overflow-y-auto« del modal padre, y el usuario vería
         media lista de eventos. Acá arriba sólo se monta cuando hay factura, así
         que «invoiceId« (input requerido) nunca se queda sin valor. -->
    @if (detail(); as inv) {
      <vendix-dian-event-register-modal
        [(isOpen)]="eventModalOpen"
        [invoiceId]="inv.id"
        [invoiceNumber]="inv.invoice_number"
      ></vendix-dian-event-register-modal>
    }
    `
})
export class InvoiceDetailComponent {
  /**
   * `model()` publica su propio `isOpenChange`. El `output()` manual que habia
   * aqui era un segundo canal para el mismo estado: el padre se enteraba del
   * cierre, pero el `input` interno seguia en `true` (patron prohibido en
   * `vendix-frontend-modal`).
   */
  readonly isOpen = model<boolean>(false);
  readonly invoice = input<Invoice | null>(null);
  readonly creditNote = output<Invoice>();

  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private invoicingService = inject(InvoicingService);
  private toast = inject(ToastService);

  private readonly storeRejection = this.store.selectSignal(selectDianRejection);
  private readonly hydratedInvoice = this.store.selectSignal(selectCurrentInvoice);
  private readonly allEvents = this.store.selectSignal(selectDianEvents);
  private readonly eventsInvoiceId = this.store.selectSignal(
    selectDianEventsInvoiceId,
  );
  readonly eventsLoading = this.store.selectSignal(selectDianEventsLoading);
  readonly pdfRegenerating = this.store.selectSignal(selectPdfRegenerating);

  /** Descarga del PDF en curso. Señal, no booleano plano: en zoneless un campo
   *  mutado dentro de un `subscribe` no repinta nada. */
  readonly pdfLoading = signal(false);

  /** Visibilidad del modal de registro de eventos RADIAN. */
  readonly eventModalOpen = signal(false);

  /**
   * Reloj que late para la cuenta regresiva de las 48 h.
   *
   * `Date.now()` leido dentro de un `computed` se congela en el primer calculo:
   * la cuenta se quedaria en el valor del momento en que se abrio el modal y
   * mentiria durante horas. Un `signal` que se reescribe cada minuto es lo que
   * hace que el `computed` de contingencia se invalide y vuelva a calcular.
   * Cada minuto basta: la ventana es de 48 h y el texto se expresa en minutos.
   */
  private readonly nowMs = signal(Date.now());

  /** Factura para la que ya se pidieron detalle y eventos, para no repetirlo. */
  private hydratedFor: number | null = null;

  constructor() {
    const ticker = setInterval(() => this.nowMs.set(Date.now()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(ticker));

    /**
     * HIDRATACION AL ABRIR.
     *
     * El padre pinta el detalle con la FILA DE LA LISTA, y esa fila no trae
     * `invoice_items` ni `invoice_taxes` (`findAll` sólo hace `include` de
     * customer/resolution/created_by_user). Por eso la tabla de productos salía
     * siempre vacía sobre facturas que sí tenían líneas. `GET :id` sí las trae.
     *
     * `untracked` alrededor de los dispatch: sin él, la escritura en el store
     * que el propio efecto provoca volvería a entrar por las señales que lee y
     * el efecto se realimentaría.
     */
    effect(() => {
      const open = this.isOpen();
      const base = this.invoice();
      if (!open || !base) {
        // Cerrar reinicia el candado: reabrir la MISMA factura debe volver a
        // pedir datos frescos, no reutilizar los de hace media hora.
        this.hydratedFor = null;
        return;
      }
      if (this.hydratedFor === base.id) {
        return;
      }
      this.hydratedFor = base.id;
      untracked(() => {
        this.store.dispatch(InvoicingActions.loadInvoice({ id: base.id }));
        if (base.cufe) {
          this.store.dispatch(
            InvoicingActions.loadDianEvents({ invoiceId: base.id }),
          );
        }
      });
    });

    // El PDF regenerado se abre cuando la respuesta llega con su URL firmada.
    // Se escucha la accion de exito en vez de suscribirse al HTTP desde aqui
    // para no duplicar la llamada que el effect ya hace.
    this.actions$
      .pipe(
        ofType(InvoicingActions.regenerateInvoicePdfSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ id, url }) => {
        if (url && id === this.detail()?.id) {
          this.openUrl(url);
        }
      });
  }

  /**
   * La factura que se pinta: la fila de la lista ENRIQUECIDA con el detalle
   * completo cuando ya llegó.
   *
   * El orden del spread importa: `full` (de `GET :id`) manda porque es el dato
   * fresco. Ambos traen `retry_status` —`findOne` lo adjunta con el mismo
   * criterio que `findAll`; lo contrario decía este comentario y era falso—, así
   * que el fusionado se queda con el del detalle, que es el más reciente. El
   * `...base` de abajo sigue siendo necesario para cualquier clave que la lista
   * traiga y el detalle no, no para ésta en particular.
   */
  readonly detail = computed<Invoice | null>(() => {
    const base = this.invoice();
    if (!base) {
      return null;
    }
    const full = this.hydratedInvoice();
    return full && full.id === base.id ? { ...base, ...full } : base;
  });

  /**
   * EL MOTIVO DEL RECHAZO, VENGA DE DONDE VENGA.
   *
   * Dos fuentes, un solo panel:
   *
   *  1. EL ERROR EN VIVO (`dianRejection` del store). Manda porque es el mas
   *     reciente: es la respuesta del intento que el usuario acaba de hacer, y
   *     puede ser mas nueva que la fila que se cargo al abrir el modal.
   *  2. LO PERSISTIDO (`invoice.provider_response`). El respaldo, y el que
   *     resuelve el fallo real: el error en vivo es transitorio —el reducer lo
   *     limpia en cuatro puntos, `loadInvoice` incluido— asi que al recargar la
   *     pagina, o al abrir una factura rechazada de ayer, el panel quedaba
   *     vacio y el badge «Rechazado por la DIAN» no venia con una sola regla.
   *     El backend ya guardaba esa evidencia; nadie la leia.
   *
   * El error en vivo solo se pinta sobre la factura que lo produjo:
   * `details.invoice_id` es el amarre. Sin ese filtro, el rechazo de una
   * factura se mostraria encima de cualquier otra que el usuario abriera
   * despues — y ahora, ademas, taparia el motivo persistido de esa otra.
   *
   * Las dos fuentes producen el MISMO `DianRejection`, asi que el template no
   * distingue de cual salio: un solo camino de render, un solo copy.
   */
  readonly rejection = computed<DianRejection | null>(() => {
    const inv = this.detail();
    if (!inv) {
      return null;
    }
    const live = this.storeRejection();
    if (live && (live.invoiceId == null || live.invoiceId === inv.id)) {
      return live;
    }
    return readPersistedDianRejection(inv);
  });

  /** Los tres estados fiscales + el de envío, ya traducidos. */
  readonly fiscalCells = computed<FiscalStatusCell[]>(() => {
    const inv = this.detail();
    return inv ? fiscalStatusCells(inv) : [];
  });

  /** Ventana de contingencia con su cuenta regresiva viva. */
  readonly contingency = computed<ContingencyWindow | null>(() => {
    const inv = this.detail();
    return inv ? readContingency(inv, this.nowMs()) : null;
  });

  /**
   * Eventos RADIAN de ESTA factura, en orden cronológico ascendente.
   *
   * El backend los devuelve `id desc` (más nuevo primero); acá se invierten
   * porque una pista de auditoría se lee de lo que pasó primero a lo último.
   * El `id` es el consecutivo del evento, así que ordenar por él es ordenar por
   * el momento en que Vendix lo registró — más fiable que `issued_at`, que es
   * nullable.
   */
  readonly events = computed<DianDocumentEvent[]>(() => {
    const inv = this.detail();
    if (!inv || this.eventsInvoiceId() !== inv.id) {
      return [];
    }
    return [...this.allEvents()].sort((a, b) => a.id - b.id);
  });

  /**
   * Líneas del documento. Se leen PRIMERO los nombres reales del backend
   * (`invoice_items`, como nombra Prisma la relación) y sólo después el alias
   * `items` que el frontend declaraba: leyendo únicamente `items` la tabla
   * salía vacía SIEMPRE, porque ninguna respuesta del backend usa ese nombre.
   */
  readonly lines = computed<InvoiceItem[]>(() => {
    const inv = this.detail();
    return inv?.invoice_items ?? inv?.items ?? [];
  });

  readonly taxLines = computed<InvoiceTax[]>(() => {
    const inv = this.detail();
    return inv?.invoice_taxes ?? inv?.taxes ?? [];
  });

  readonly canValidate = computed(() => this.detail()?.status === 'draft');

  readonly canSend = computed(() => this.detail()?.status === 'validated');

  /**
   * Un documento en contingencia sigue en `validated` —`handleContingency` no
   * toca `status`—, así que el botón es el mismo. Cambia el verbo: no se está
   * enviando por primera vez, se está saldando la deuda de las 48 h.
   */
  readonly sendLabel = computed(() =>
    this.detail()?.transmission_status === 'contingency'
      ? 'Retransmitir a la DIAN'
      : 'Enviar',
  );

  /**
   * REENVÍO. `VALID_TRANSITIONS` del backend autoriza `rejected → sent`, que es
   * la única forma legítima de volver a intentar un documento que la DIAN
   * devolvió (corregido antes, se entiende). No existe endpoint de "resend".
   */
  readonly canResend = computed(() => this.detail()?.status === 'rejected');

  readonly canCreateCreditNote = computed(
    () =>
      this.detail()?.status === 'accepted' &&
      this.detail()?.invoice_type === 'sales_invoice',
  );

  readonly canAccept = computed(() => this.detail()?.status === 'sent');

  readonly canReject = computed(() => this.detail()?.status === 'sent');

  readonly canCancel = computed(
    () =>
      this.detail()?.status === 'draft' ||
      this.detail()?.status === 'validated',
  );

  /**
   * Anular sólo lo que la DIAN NUNCA aceptó.
   *
   * `accepted` salía de acá y el backend contestaba 409 sin excepción
   * (`invoice-flow.service.ts` → `void()`): el botón era un callejón sin
   * salida que además insinuaba que anular una factura ya aceptada era
   * posible. La acción correcta para ese estado ya está al lado —
   * `canCreateCreditNote()` pinta «Nota Crédito» exactamente para
   * `accepted`—, así que quitarlo no deja al usuario sin salida: lo deja
   * con la única que la DIAN reconoce.
   */
  readonly canVoid = computed(() => this.detail()?.status === 'rejected');

  /** `FAB10a: Valor del CUFE no está calculado correctamente`. */
  describeReason(reason: DianRejectionReason): string {
    return formatReason(reason);
  }

  // ── Helpers de presentación (delegan en el util) ──────────

  tone = toneClasses;
  retryLabel = retryStatusLabel;
  retryTone = retryStatusTone;
  eventLabel = dianEventLabel;
  eventStatus = dianEventStatusLabel;
  eventTone = dianEventStatusTone;

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  /** True when the line consumed packaging stock different from its quantity. */
  isPackageLine(item: InvoiceItem): boolean {
    return (
      typeof item.stock_units_consumed === 'number' &&
      item.stock_units_consumed > 0 &&
      item.stock_units_consumed !== item.quantity
    );
  }

  /** Units of stock consumed per sold unit (packaging factor), rounded to 2dp. */
  packagePerUnit(item: InvoiceItem): number {
    const consumed = item.stock_units_consumed ?? 0;
    const qty = item.quantity || 1;
    return Math.round((consumed / qty) * 100) / 100;
  }

  // ── Transiciones de estado ────────────────────────────────

  onValidate(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.validateInvoice({ id: inv.id }));
    }
  }

  onSend(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.sendInvoice({ id: inv.id }));
    }
  }

  onAccept(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.acceptInvoice({ id: inv.id }));
    }
  }

  onReject(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.rejectInvoice({ id: inv.id }));
    }
  }

  onCancel(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.cancelInvoice({ id: inv.id }));
    }
  }

  onVoid(): void {
    const inv = this.detail();
    if (inv) {
      this.store.dispatch(InvoicingActions.voidInvoice({ id: inv.id }));
    }
  }

  // ── Eventos RADIAN ────────────────────────────────────────

  reloadEvents(): void {
    const inv = this.detail();
    if (inv && !this.eventsLoading()) {
      this.store.dispatch(InvoicingActions.loadDianEvents({ invoiceId: inv.id }));
    }
  }

  openEventModal(): void {
    this.eventModalOpen.set(true);
  }

  // ── Documentos ────────────────────────────────────────────

  copyCufe(): void {
    const cufe = this.detail()?.cufe;
    if (cufe) {
      navigator.clipboard.writeText(cufe);
      this.toast.success('CUFE copiado');
    }
  }

  /**
   * Descarga el PDF pidiendo la URL FIRMADA.
   *
   * `invoices.pdf_url` NO es una URL sino la llave S3
   * (`stores/{id}/invoices/{id}/invoice-XXX.pdf`, ver `invoice-pdf.service.ts`):
   * el `window.open(invoice.pdf_url)` anterior abría una ruta relativa rota.
   * `GET :id/pdf` la firma, y si la factura todavía no tiene PDF lo genera.
   *
   * Va por el servicio y no por NgRx a propósito: es una LECTURA, y encadenar
   * el `window.open` a un effect alejaría la apertura del gesto del usuario que
   * la autoriza. El error se reporta con el mismo copy curado que usan los
   * effects (`describeApiFailure` → `ERROR_MESSAGES[error_code]`), nunca con el
   * mensaje de desarrollador del backend.
   */
  downloadPdf(): void {
    const inv = this.detail();
    if (!inv || this.pdfLoading()) {
      return;
    }
    this.pdfLoading.set(true);
    this.invoicingService
      .getInvoicePdfUrl(inv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.pdfLoading.set(false);
          const url = response?.data?.url;
          if (!url) {
            this.toast.error('El servidor no devolvió la URL del PDF');
            return;
          }
          this.openUrl(url);
        },
        error: (error: unknown) => {
          this.pdfLoading.set(false);
          this.toast.error(describeApiFailure(error).message);
        },
      });
  }

  /** Reconstruye el PDF en el servidor. Mutación ⇒ va por acción + effect. */
  regeneratePdf(): void {
    const inv = this.detail();
    if (inv && !this.pdfRegenerating()) {
      this.store.dispatch(InvoicingActions.regenerateInvoicePdf({ id: inv.id }));
    }
  }

  /**
   * Descarga el XML firmado.
   *
   * NO hay endpoint de XML en `invoicing.controller.ts` — se verificó ruta por
   * ruta. Lo que sí hay es la columna `invoices.xml_document`, que viaja entera
   * en el payload de la factura porque el backend hace `include` sin `select`.
   * Con eso el archivo se arma en el navegador, sin inventar una ruta que el
   * servidor no expone.
   */
  downloadXml(): void {
    const inv = this.detail();
    const xml = inv?.xml_document;
    if (!inv || !xml) {
      return;
    }
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${inv.invoice_number}.xml`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // El objeto vive hasta que el navegador termina de leerlo; revocarlo en el
    // mismo tick aborta la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Abre una URL firmada. Si el bloqueador de ventanas emergentes la corta,
   * `window.open` devuelve `null` y hay que DECIRLO: un click sin efecto ni
   * mensaje es el mismo fallo silencioso que este trabajo vino a cerrar.
   */
  private openUrl(url: string): void {
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) {
      this.toast.warning(
        'El navegador bloqueó la ventana del documento. Permite las ventanas emergentes para este sitio.',
      );
    }
  }

  navigateToOrder(): void {
    // Emit event for parent to handle navigation
    this.isOpen.set(false);
  }

  onClose(): void {
    this.isOpen.set(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
      voided: 'Anulada',
    };
    return labels[status] || status;
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      sales_invoice: 'Factura de Venta',
      purchase_invoice: 'Factura de Compra',
      credit_note: 'Nota Crédito',
      debit_note: 'Nota Débito',
      export_invoice: 'Factura de Exportación',
    };
    return labels[type] || type;
  }

  getStatusClasses(status: string): Record<string, boolean> {
    const map: Record<string, string> = {
      draft: 'bg-[var(--color-surface-secondary)] text-text-secondary',
      validated: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      sent: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      accepted: 'bg-success-light text-success',
      rejected: 'bg-error-light text-error',
      cancelled: 'bg-warning-light text-warning',
      voided: 'bg-[var(--color-surface-secondary)] text-text-secondary',
    };
    const classes = (map[status] || 'bg-[var(--color-surface-secondary)] text-text-secondary').split(' ');
    return classes.reduce((acc, cls) => ({ ...acc, [cls]: true }), {} as Record<string, boolean>);
  }
}
