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

          <!-- ── ADQUIRIENTE ────────────────────────────────────────────────
               Ficha en tarjeta, no cuatro «Etiqueta: valor» sueltos. Y con
               estado vacío REAL: antes, una factura cuyo snapshot estaba en
               null pintaba cuatro guiones seguidos aunque tuviera cliente
               asociado — se veía rota y no decía nada. Ahora o hay ficha, o hay
               una frase que explica que es una venta de mostrador.
          -->
          <section class="mb-4">
            <h4 class="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <app-icon name="user" [size]="15" class="text-text-secondary" />
              Adquiriente
            </h4>

            @if (hasAcquirer()) {
              <div class="rounded-xl border border-border bg-surface-secondary/40 p-4">
                <div class="flex items-start gap-3">
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full
                           bg-primary/10 text-sm font-semibold text-primary"
                  >
                    {{ acquirerInitials() }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-text-primary">
                      {{ acquirerName() }}
                    </p>
                    @if (acquirerDocument(); as doc) {
                      <p class="text-xs text-text-secondary">{{ doc }}</p>
                    }
                  </div>
                </div>

                @if (acquirerEmail() || acquirerPhone() || inv.customer_address) {
                  <dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-3 sm:grid-cols-2">
                    @if (acquirerEmail(); as mail) {
                      <div class="min-w-0">
                        <dt class="text-[11px] uppercase tracking-wide text-text-secondary">Correo</dt>
                        <dd class="truncate text-sm text-text-primary">{{ mail }}</dd>
                      </div>
                    }
                    @if (acquirerPhone(); as phone) {
                      <div class="min-w-0">
                        <dt class="text-[11px] uppercase tracking-wide text-text-secondary">Teléfono</dt>
                        <dd class="truncate text-sm text-text-primary">{{ phone }}</dd>
                      </div>
                    }
                    @if (acquirerAddress(); as addr) {
                      <div class="min-w-0 sm:col-span-2">
                        <dt class="text-[11px] uppercase tracking-wide text-text-secondary">Dirección</dt>
                        <dd class="text-sm text-text-primary">{{ addr }}</dd>
                      </div>
                    }
                  </dl>
                }
              </div>
            } @else {
              <div
                class="flex items-start gap-2 rounded-xl border border-dashed border-border
                       bg-surface-secondary/30 p-4"
              >
                <app-icon name="users" [size]="16" class="mt-0.5 text-text-secondary" />
                <div>
                  <p class="text-sm font-medium text-text-primary">Venta a consumidor final</p>
                  <p class="text-xs text-text-secondary">
                    El documento no identifica adquiriente, así que viaja con el
                    <code class="rounded bg-surface px-1">222222222222</code> que la DIAN reserva
                    para el mostrador. Es válido en caja; una factura nominativa sí tiene que
                    identificarlo.
                  </p>
                </div>
              </div>
            }
          </section>

          <!-- ── FECHAS, MONEDA Y TIPO DE OPERACIÓN ─────────────────────────
               La divisa se pinta aquí y no en los totales porque no es un
               importe: es una DECLARACIÓN sobre el documento. El total siempre
               va en pesos (Art. 73 Res. 000042/2020); lo que la operación
               pactó en otra moneda se dice al lado, con su TRM y su fecha.
          -->
          <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-lg border border-border px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-text-secondary">Emisión</p>
              <p class="text-sm font-medium text-text-primary">
                {{ inv.issue_date | date:'dd/MM/yyyy':'UTC' }}
              </p>
            </div>
            <div class="rounded-lg border border-border px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-text-secondary">Vencimiento</p>
              <p class="text-sm font-medium text-text-primary">
                {{ inv.due_date ? (inv.due_date | date:'dd/MM/yyyy':'UTC') : 'Contado' }}
              </p>
            </div>
            <div class="rounded-lg border border-border px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-text-secondary">Moneda</p>
              <p class="text-sm font-medium text-text-primary">{{ inv.currency || 'COP' }}</p>
            </div>
            <div class="rounded-lg border border-border px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-text-secondary">Operación</p>
              <p class="text-sm font-medium text-text-primary">{{ operationTypeLabel() }}</p>
            </div>
          </div>

          @if (exchangeDeclaration(); as fx) {
            <div
              class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border
                     border-[var(--color-info)]/30 bg-[var(--color-info-light)] px-3 py-2"
            >
              <div class="flex items-center gap-2">
                <app-icon name="refresh-cw" [size]="14" class="text-[var(--color-info)]" />
                <span class="text-xs font-semibold text-[var(--color-info)]">
                  Operación pactada en {{ fx.currency }}
                </span>
              </div>
              @if (fx.foreignTotal) {
                <span class="text-xs text-[var(--color-info)]">Valor: {{ fx.foreignTotal }}</span>
              }
              @if (fx.rate) {
                <span class="text-xs text-[var(--color-info)]">TRM: {{ fx.rate }}</span>
              }
              @if (fx.date) {
                <span class="text-xs text-[var(--color-info)]">
                  del {{ fx.date | date:'dd/MM/yyyy':'UTC' }}
                </span>
              }
            </div>
          }

          <!-- ── RESOLUCIÓN — INFORMATIVA, NUNCA UN SELECTOR ────────────────
               Se pintan prefijo, número, rango, consecutivo consumido y
               vigencia — NUNCA «technical_key». La ClTec es el secreto con el
               que se calcula el CUFE; el backend ya la excluye del payload
               (RESOLUTION_PUBLIC_SELECT) y aquí no se reintroduce.

               El rango y la vigencia se pintan con su estado: una resolución al
               95% de su numeración o a tres semanas de vencer es una emisión
               que va a fallar pronto, y el sitio donde el comerciante lo puede
               ver es esta factura.
          -->
          @if (resolutionBanner(); as res) {
            <section
              class="mb-4 rounded-xl border border-[var(--color-info)]/30
                     bg-[var(--color-info-light)] p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-info)]">
                    <app-icon name="file-text" [size]="14" />
                    Resolución DIAN
                  </p>
                  <p class="mt-1 text-sm font-semibold text-text-primary">
                    {{ res.number }}
                  </p>
                  <p class="text-xs text-text-secondary">
                    Prefijo <span class="font-medium text-text-primary">{{ res.prefix }}</span>
                    · rango {{ res.rangeFrom }}–{{ res.rangeTo }}
                  </p>
                </div>

                <div class="flex flex-wrap gap-2">
                  <span
                    class="rounded-full px-2.5 py-1 text-xs font-medium"
                    [ngClass]="res.usageTone"
                  >
                    {{ res.usageLabel }}
                  </span>
                  <span
                    class="rounded-full px-2.5 py-1 text-xs font-medium"
                    [ngClass]="res.validityTone"
                  >
                    {{ res.validityLabel }}
                  </span>
                </div>
              </div>

              <!-- Barra de consumo: el número autorizado que queda es lo que de
                   verdad limita cuántas facturas más se pueden emitir. -->
              <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div
                  class="h-full rounded-full transition-[width] duration-300"
                  [ngClass]="res.barTone"
                  [style.width.%]="res.usedPercent"
                ></div>
              </div>
            </section>
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
                    <!-- «Impuestos», no «IVA»: la columna suma TODO lo que grava
                         la línea. Rotularla IVA sobre una línea con INC o ICA
                         hace que el número no cuadre con nada y que nadie sepa
                         qué impuesto está mirando. -->
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Impuestos</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of lines(); track item.id) {
                    <tr class="border-b border-border">
                      <td class="py-2 px-2 text-text-primary">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span>{{ item.product_name || item.description }}</span>
                          <!-- La marca AIU decide si la línea se grava y si sale
                               con «cac:TaxTotal». Sin pintarla, un documento AIU
                               es indistinguible de uno estándar en pantalla. -->
                          @if (aiuLabel(item); as aiu) {
                            <span
                              class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px]
                                     font-medium text-primary"
                              [title]="aiu.hint"
                            >
                              {{ aiu.label }}
                            </span>
                          }
                          @if (item.is_inclusive) {
                            <span
                              class="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-text-secondary"
                              title="El precio de la línea ya trae el impuesto dentro."
                            >
                              IVA incluido
                            </span>
                          }
                        </div>
                        @if (item.applied_price_tier_name) {
                          <span class="block text-xs text-text-secondary">Tarifa: {{ item.applied_price_tier_name }}</span>
                        }
                        @if (isPackageLine(item)) {
                          <span class="block text-xs text-text-secondary">
                            {{ item.quantity }} paq. = {{ item.stock_units_consumed }} u. (×{{ packagePerUnit(item) }})
                          </span>
                        }
                        @if (lineFiscalNote(item); as note) {
                          <span class="block text-xs text-text-secondary">{{ note }}</span>
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
          <!-- ── TOTALES ────────────────────────────────────────────────────
               LA RETENCIÓN NO RESTA DEL TOTAL, y esta columna tenía que
               dejarlo de decir. El Anexo 1.9 §11.9.1 es literal: la validación
               previa de la DIAN «no incluye en el fragmento
               <cac:LegalMonetaryTotal/> operaciones con el elemento
               <cac:WithholdingTaxTotal/>». El backend ya lo respeta —
               total_amount NO descuenta la retención— pero la pantalla la
               pintaba con signo menos justo encima del total, de modo que la
               columna no cuadraba: 1.500.000 + 190.000 − 37.500 ≠ 1.690.000. El
               comerciante veía una suma rota en el documento que va a la DIAN.

               Ahora el total del documento cierra con lo que suma, y la
               retención va DEBAJO, separada, con el neto que efectivamente se
               recauda — que es un dato de tesorería, no del documento fiscal.
          -->
          <div class="rounded-xl border border-border bg-surface-secondary/40 p-4">
            <div class="space-y-1.5">
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Subtotal</span>
                <span class="text-text-primary">{{ formatCurrency(inv.subtotal_amount) }}</span>
              </div>
              @if (inv.discount_amount > 0) {
                <div class="flex justify-between text-sm">
                  <span class="text-text-secondary">Descuentos</span>
                  <span class="text-error">−{{ formatCurrency(inv.discount_amount) }}</span>
                </div>
              }
              @if (shippingAmount() > 0) {
                <div class="flex justify-between text-sm">
                  <span class="text-text-secondary">Envío</span>
                  <span class="text-text-primary">{{ formatCurrency(shippingAmount()) }}</span>
                </div>
              }
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Impuestos</span>
                <span class="text-text-primary">{{ formatCurrency(inv.tax_amount) }}</span>
              </div>
            </div>

            <div
              class="mt-2 flex items-baseline justify-between border-t border-border pt-2"
            >
              <span class="text-base font-semibold text-text-primary">Total del documento</span>
              <span class="text-lg font-bold text-primary">
                {{ formatCurrency(inv.total_amount) }}
              </span>
            </div>

            @if (withholdingAmount() > 0) {
              <div class="mt-3 space-y-1.5 rounded-lg bg-surface px-3 py-2.5">
                <div class="flex items-start gap-2">
                  <app-icon name="info" [size]="14" class="mt-0.5 text-text-secondary" />
                  <p class="text-xs text-text-secondary">
                    La retención no descuenta del total facturado: la DIAN valida
                    <code class="rounded bg-surface-secondary px-1">PayableAmount</code> sin ella
                    (Anexo 1.9 §11.9.1). Se declara aparte y afecta lo que se recauda, no lo que
                    se factura.
                  </p>
                </div>
                <div class="flex justify-between text-sm">
                  <span class="text-text-secondary">Retenciones declaradas</span>
                  <span class="font-medium text-warning">
                    {{ formatCurrency(withholdingAmount()) }}
                  </span>
                </div>
                <div class="flex justify-between border-t border-border pt-1.5 text-sm">
                  <span class="font-medium text-text-primary">Neto a recaudar</span>
                  <span class="font-semibold text-text-primary">
                    {{ formatCurrency(netCollectable()) }}
                  </span>
                </div>
              </div>
            }
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

  // ───────────────────────────────────────────────────────────────────────────
  // ADQUIRIENTE — snapshot primero, ficha viva después.
  //
  // El orden no es capricho: `customer_name` / `customer_tax_id` son lo que
  // VIAJÓ a la DIAN y lo que hay que mostrar sobre un documento ya emitido,
  // aunque el cliente se haya renombrado después. La ficha viva sólo rellena lo
  // que el snapshot dejó en null — que es el caso normal de una factura creada
  // desde el modal, donde el nombre no se teclea a mano.
  // ───────────────────────────────────────────────────────────────────────────

  readonly acquirerName = computed(() => {
    const inv = this.detail();
    const snapshot = (inv?.customer_name ?? '').trim();
    if (snapshot) return snapshot;
    const live = [inv?.customer?.first_name, inv?.customer?.last_name]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return live || '';
  });

  readonly acquirerDocument = computed(() => {
    const inv = this.detail();
    const id = (inv?.customer_tax_id ?? '').trim();
    if (!id) return '';
    const dv = (inv?.customer_verification_digit ?? '').toString().trim();
    const type = (inv?.customer_document_type ?? '').toString().trim();
    const number = dv ? `${id}-${dv}` : id;
    return type ? `${type} ${number}` : number;
  });

  readonly acquirerEmail = computed(() => {
    const inv = this.detail();
    return (inv?.customer_email ?? inv?.customer?.email ?? '').trim();
  });

  readonly acquirerPhone = computed(() => {
    const inv = this.detail();
    return (inv?.customer_phone ?? inv?.customer?.phone ?? '').trim();
  });

  /**
   * `invoices.customer_address` es JSONB y el histórico guardó ahí tanto un
   * objeto como una cadena suelta. Se aplana a una línea legible sin leer
   * propiedades de un `string`, que devolvería `undefined` en silencio.
   */
  readonly acquirerAddress = computed(() => {
    const raw = this.detail()?.customer_address as unknown;
    if (!raw) return '';
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw !== 'object') return '';
    const addr = raw as Record<string, unknown>;
    const parts = [
      addr['address_line'] ?? addr['address_line_1'] ?? addr['address_line1'],
      addr['city_name'] ?? addr['city'],
      addr['department_name'] ?? addr['state'],
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean);
    return parts.join(', ');
  });

  readonly hasAcquirer = computed(
    () =>
      !!(
        this.acquirerName() ||
        this.acquirerDocument() ||
        this.acquirerEmail() ||
        this.acquirerPhone()
      ),
  );

  readonly acquirerInitials = computed(() => {
    const name = this.acquirerName();
    if (!name) return '—';
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
    return initials || '—';
  });

  /**
   * `CustomizationID` en palabras. Un código de dos dígitos en pantalla no le
   * dice nada a nadie, y este en concreto tiene que ser COHERENTE con las
   * líneas: `'09'` sobre líneas sin AIU, o `'10'` sobre líneas con AIU, es un
   * documento que la DIAN rechaza.
   */
  readonly operationTypeLabel = computed(() => {
    const code = (this.detail()?.operation_type ?? '').toString().trim();
    return InvoiceDetailComponent.OPERATION_TYPES[code] ?? (code || 'Estándar');
  });

  /**
   * La declaración de divisa, o `null` cuando la operación fue en pesos.
   *
   * Se exige la MONEDA para pintar el bloque: una `exchange_rate` suelta sobre
   * una operación en COP es ruido histórico, no una operación en divisa.
   */
  readonly exchangeDeclaration = computed(() => {
    const inv = this.detail();
    const currency = (inv?.foreign_currency ?? '').toString().trim();
    if (!currency) return null;

    const rate = this.toNumber(inv?.exchange_rate);
    const foreignTotal = this.toNumber(inv?.foreign_total_amount);

    return {
      currency,
      rate: rate > 0 ? this.currencyService.format(rate) : '',
      foreignTotal:
        foreignTotal > 0
          ? `${foreignTotal.toLocaleString('es-CO', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} ${currency}`
          : '',
      date: inv?.exchange_rate_date ?? null,
    };
  });

  /**
   * Estado de la resolución que respalda ESTE documento, con su consumo y su
   * vigencia ya juzgados.
   *
   * Es informativo por diseño (nunca un selector): la resolución de una factura
   * la elige el generador de consecutivos, no el usuario. Lo que sí necesita
   * ver es cuánto rango le queda y cuándo vence, porque las dos cosas hacen
   * fallar la PRÓXIMA emisión y este es el sitio donde las está mirando.
   */
  readonly resolutionBanner = computed(() => {
    const res = this.detail()?.resolution;
    if (!res) return null;

    const from = Number(res.range_from) || 0;
    const to = Number(res.range_to) || 0;
    const current = Number(res.current_number) || 0;
    const total = Math.max(0, to - from + 1);
    // `current_number` arranca en `range_from - 1`: hasta que la DIAN no vio un
    // consecutivo, lo consumido es cero y no puede pintarse como uno.
    const used = total > 0 ? Math.min(total, Math.max(0, current - from + 1)) : 0;
    const remaining = Math.max(0, total - used);
    const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0;

    const exhausted = total > 0 && remaining === 0;
    const running_low = !exhausted && total > 0 && remaining <= Math.ceil(total * 0.1);

    const valid_to = res.valid_to ? new Date(res.valid_to) : null;
    const days_left =
      valid_to && !Number.isNaN(valid_to.getTime())
        ? Math.floor((valid_to.getTime() - this.nowMs()) / 86_400_000)
        : null;
    const expired = days_left !== null && days_left < 0;
    const expiring = !expired && days_left !== null && days_left <= 30;

    const tone = (state: 'ok' | 'warn' | 'bad') =>
      state === 'bad'
        ? 'bg-error-light text-error'
        : state === 'warn'
          ? 'bg-warning-light text-warning'
          : 'bg-success-light text-success';

    return {
      number: `Resolución ${res.resolution_number}`,
      prefix: res.prefix,
      rangeFrom: from,
      rangeTo: to,
      usedPercent,
      usageLabel: exhausted
        ? 'Rango agotado'
        : `Consecutivo ${current} · quedan ${remaining} de ${total}`,
      usageTone: tone(exhausted ? 'bad' : running_low ? 'warn' : 'ok'),
      barTone: exhausted
        ? 'bg-error'
        : running_low
          ? 'bg-warning'
          : 'bg-success',
      validityLabel: expired
        ? 'Vigencia vencida'
        : days_left === null
          ? 'Sin vigencia registrada'
          : expiring
            ? `Vence en ${days_left} día${days_left === 1 ? '' : 's'}`
            : `Vigente hasta ${new Date(res.valid_to!).toLocaleDateString('es-CO')}`,
      validityTone: tone(expired ? 'bad' : expiring || days_left === null ? 'warn' : 'ok'),
    };
  });

  readonly withholdingAmount = computed(() =>
    this.toNumber(this.detail()?.withholding_amount),
  );

  readonly shippingAmount = computed(() =>
    this.toNumber(this.detail()?.shipping_amount),
  );

  /**
   * Lo que de verdad entra a caja: el total facturado MENOS la retención que el
   * adquiriente practica. No es el total del documento —ese no la resta, §11.9.1—
   * y por eso vive en su propio bloque y con su propio rótulo.
   */
  readonly netCollectable = computed(() =>
    Math.max(0, this.toNumber(this.detail()?.total_amount) - this.withholdingAmount()),
  );

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

  /**
   * `CustomizationID` → rótulo. Tabla estática porque es un catálogo cerrado de
   * la DIAN, no una configuración de la tienda.
   */
  private static readonly OPERATION_TYPES: Record<string, string> = {
    '09': 'AIU',
    '10': 'Estándar',
    '11': 'Mandatos',
    '12': 'Transporte',
    '20': 'Nota crédito que referencia factura',
    '22': 'Nota crédito sin referencia a factura',
    '30': 'Nota débito que referencia factura',
    '32': 'Nota débito sin referencia a factura',
  };

  /**
   * Cómo se rotula la marca AIU de una línea, y qué explica al pasar el cursor.
   *
   * El texto de ayuda no es adorno: bajo el Art. 462-1 ET se grava el AIU
   * completo y bajo el Decreto 1372/1992 sólo la utilidad, así que la MISMA
   * línea de «Imprevistos» lleva impuesto o no según el régimen configurado. Lo
   * que la pantalla puede afirmar sin conocer el régimen es qué componente es;
   * lo demás lo dice la línea misma con su columna de impuestos.
   */
  aiuLabel(item: InvoiceItem): { label: string; hint: string } | null {
    switch (item.aiu_component) {
      case 'administracion':
        return {
          label: 'AIU · Administración',
          hint: 'Componente de Administración del contrato AIU. Es la línea que lleva la nota «Contrato de servicios AIU por concepto de:» exigida por el Anexo 1.9 §CAV03.',
        };
      case 'imprevistos':
        return {
          label: 'AIU · Imprevistos',
          hint: 'Componente de Imprevistos. Grava sólo bajo el Art. 462-1 ET; bajo el Decreto 1372/1992 queda fuera de la base gravable y se emite sin bloque de impuestos.',
        };
      case 'utilidad':
        return {
          label: 'AIU · Utilidad',
          hint: 'Componente de Utilidad. Es base gravable en los dos regímenes.',
        };
      default:
        return null;
    }
  }

  /**
   * La segunda línea fiscal de un ítem: unidad declarada y subcuenta PUC.
   *
   * Cadena vacía cuando no hay nada que decir — `null` obligaría al template a
   * distinguir dos formas de ausencia sin ganar nada.
   */
  lineFiscalNote(item: InvoiceItem): string {
    const parts: string[] = [];
    if (item.unit_code) parts.push(`Unidad ${item.unit_code}`);
    if (item.account_code) parts.push(`Cuenta ${item.account_code}`);
    return parts.join(' · ');
  }

  /**
   * Prisma serializa `Decimal` como STRING. `value > 0` sobre `"37500"` es una
   * comparación entre string y number que TypeScript no deja pasar y que en
   * JavaScript daría el resultado correcto por coerción — pero `"0.00" > 0` es
   * `false` y `"" > 0` también, de modo que el único camino honesto es
   * normalizar una vez y comparar números.
   */
  private toNumber(value: number | string | null | undefined): number {
    const parsed = typeof value === 'string' ? Number(value) : (value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
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
