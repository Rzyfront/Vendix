import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';

import { Invoice, InvoiceItem, InvoiceNoteContext } from '../../interfaces/invoice.interface';
import {
  createCreditNote,
  createCreditNoteFailure,
  createCreditNoteSuccess,
  createDebitNote,
  createDebitNoteFailure,
  createDebitNoteSuccess,
  issueNote,
  issueNoteFailure,
  issueNoteSuccess,
  MutationFailure,
} from '../../state/actions/invoicing.actions';
import { describeApiFailure, describeNoteIntegrityDetails, extractValidationMessages } from '../../utils/invoicing-errors.util';
import { findNoteConcept, noteConcepts, NOTE_CONCEPT_GUIDANCE } from './dian-note-concepts';
import {
  NOTE_REASON_LIMIT,
  NoteLineSelection,
  buildNotePayload,
  buildNoteReason,
  invoiceLines,
  noteTotals,
  num,
  estimateLine,
  round2,
} from './invoice-note-payload.util';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { UNIT_CODE_OPTIONS } from '../../../../../../shared/components/invoice-sections/invoice-dian-catalogs';
import { InvoicingService } from '../../services/invoicing.service';
import { remainingChars, showCharCounter } from '../../utils/char-limit.util';

interface NoteLineState {
  selected: boolean;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  unit_code: string;
  discount_overridden: boolean;
  controls: {
    quantity: FormControl<number>;
    unit_price: FormControl<number>;
    discount_amount: FormControl<number>;
    unit_code: FormControl<string>;
  };
}

interface PendingNoteCreate {
  relatedInvoiceId: number;
  invoiceType: 'credit_note' | 'debit_note';
}

/**
 * F.6/defecto 2 (orquestador, 2026-08-25): este campo alimenta DOS DTO —
 * `reason` (500, resumen estructurado) Y `notes` (5.000, texto completo,
 * `buildNotePayload` en `invoice-note-payload.util.ts`). El tope que el
 * USUARIO ve tiene que ser el de `notes`: es el que preserva lo que escribe.
 * `reason` se sigue recortando puertas adentro, en silencio, como siempre —
 * eso es un resumen, no una pérdida.
 */

/**
 * CORREGIR UNA FACTURA YA ACEPTADA POR LA DIAN.
 *
 * ## Por qué existe este modal
 *
 * El comerciante reportó que no encontraba las notas por ninguna parte, y tenía
 * razón, aunque no por la razón que parecía: el modal anterior
 * (`credit-note-create`) SÍ existía y estaba cableado — pero su único punto de
 * entrada era un botón del pie del detalle condicionado a
 * `status === 'accepted'`. Con cero facturas aceptadas en la tienda, ese botón
 * no se pintaba nunca. La función estaba construida y era invisible, que desde
 * la silla del usuario es indistinguible de no estar.
 *
 * Por eso acá el punto de entrada NO se esconde: el detalle pinta los dos
 * botones siempre, apagados y con el motivo escrito cuando todavía no aplican.
 *
 * ## Las tres cosas que este modal captura y el anterior no
 *
 * **1. El concepto de corrección de la DIAN.** Hay un catálogo —cinco conceptos
 * para nota crédito, cuatro para nota débito— y elegir el equivocado cambia lo
 * que el documento AFIRMA. El código elegido viaja al backend en
 * `note_concept_code`, se persiste en `invoices.note_concept_code` y sale en
 * `cac:DiscrepancyResponse/cbc:ResponseCode`; el motivo, con el concepto
 * anotado delante, sale en el `cbc:Description` de ese mismo grupo.
 *
 * Hubo una etapa en que sólo viajaba la prosa: los builders emitían el
 * `cbc:ResponseCode` con el literal '2' pasara lo que pasara, así que una nota
 * por descuento le declaraba a la DIAN una anulación, y este modal tenía que
 * AVISAR del desacuerdo en vez de taparlo. Ese aviso ya no existe porque ya no
 * hay desacuerdo que avisar — si vuelve a haberlo, el aviso vuelve.
 *
 * **2. Las líneas.** El backend acepta notas parciales desde siempre
 * (`CreateCreditNoteDto.items`) y ninguna pantalla las ofrecía: la única nota
 * posible era la total. Devolver 2 de 5 unidades obligaba a anular la factura
 * entera.
 *
 * **3. La regla fiscal, dicha en voz alta.** Una factura aceptada no se borra
 * ni se edita. Es exactamente el callejón donde el usuario se quedó encallado,
 * y el sitio donde hay que contarlo es este.
 *
 * ## El modal no cierra hasta saber si el backend aceptó
 *
 * Se hereda del modal anterior y no es negociable: despachar y cerrar en el
 * mismo tick hace que un rechazo —nota sobre factura no aceptada, resolución de
 * notas sin numeración, impuesto sin base— se vea igual que un éxito.
 */
@Component({
  selector: 'vendix-invoice-note-create',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    TextareaComponent,
    SelectorComponent,
    InputComponent,
  ],
  template: `
    <!--
      NINGÚN ACENTO GRAVE DENTRO DE ESTE LITERAL: uno solo cierra el template
      string de TypeScript y produce una cascada de errores falsos.
    -->
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onClose()"
      [title]="title()"
      [subtitle]="subtitle()"
      size="xl"
    >
      <div class="space-y-4">
        <!-- ── LA REGLA FISCAL ────────────────────────────────────────────
             No es texto de relleno: es la respuesta a «¿por qué no puedo
             borrar esta factura?», que es la pregunta con la que el usuario
             llega hasta acá. Va arriba del todo y con jerarquía propia. -->
        <div
          class="flex items-start gap-2.5 rounded-lg border border-[var(--color-info)]/30
                 bg-[var(--color-info-light)] p-3"
        >
          <app-icon
            name="shield"
            [size]="16"
            class="mt-0.5 shrink-0 text-[var(--color-info)]"
          />
          <div class="min-w-0">
            <p class="text-xs font-semibold text-[var(--color-info)]">
              Una factura aceptada por la DIAN no se borra ni se edita
            </p>
            <p class="mt-0.5 text-xs text-text-secondary">
              Ya es un documento público con CUFE. La única corrección válida es
              emitir otro documento que la referencie: una
              <strong>nota crédito</strong> para disminuir o anular, o una
              <strong>nota débito</strong> para aumentar. La factura original
              permanece; la nota dice qué cambió.
            </p>
          </div>
        </div>

        @if (submitError()) {
          <div
            role="alert"
            class="rounded-lg border border-error bg-error-light p-3"
          >
            <div class="flex items-start gap-2">
              <app-icon name="alert-triangle" [size]="16" class="text-error" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-error">
                  No se pudo crear la {{ noteNoun() }}
                </p>
                <p class="text-sm text-error">{{ submitError() }}</p>
                @if (submitErrorDetails().length) {
                  <ul class="mt-1 list-disc space-y-0.5 pl-4 text-xs text-error">
                    @for (detail of submitErrorDetails(); track detail) { <li>{{ detail }}</li> }
                  </ul>
                }
                @if (submitErrorCode() === 'INVOICING_NOTE_SOURCE_001' || submitErrorCode() === 'INVOICING_NOTE_LIMIT_001') {
                  <button type="button" class="mt-2 min-h-11 rounded-lg border border-error px-3 text-sm text-error" (click)="retryContext()">Actualizar saldos y conservar cambios</button>
                }
              </div>
            </div>
          </div>
        }

        <!-- ── TIPO DE NOTA ──────────────────────────────────────────────── -->
        <div>
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            Tipo de documento
          </p>
          <div class="flex gap-2" role="group" aria-label="Tipo de nota">
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2 text-sm transition-colors"
              [disabled]="submitting() || !!createdNote()"
              [ngClass]="
                noteType() === 'credit'
                  ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                  : 'bg-[var(--color-surface)] text-text-primary border-border'
              "
              [attr.aria-pressed]="noteType() === 'credit'"
              (click)="setNoteType('credit')"
            >
              Nota crédito
              <span class="block text-[11px] opacity-80">Disminuye o anula</span>
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2 text-sm transition-colors"
              [disabled]="submitting() || !!createdNote()"
              [ngClass]="
                noteType() === 'debit'
                  ? 'bg-primary text-[var(--color-text-on-primary)] border-primary'
                  : 'bg-[var(--color-surface)] text-text-primary border-border'
              "
              [attr.aria-pressed]="noteType() === 'debit'"
              (click)="setNoteType('debit')"
            >
              Nota débito
              <span class="block text-[11px] opacity-80">Aumenta el valor</span>
            </button>
          </div>
        </div>

        <!-- ── FACTURA DE REFERENCIA ─────────────────────────────────────── -->
        <div class="rounded-lg border border-border bg-surface-secondary/40 p-3">
          <p class="text-[11px] uppercase tracking-wide text-text-secondary">
            Factura que se corrige
          </p>
          <p class="text-sm font-semibold text-text-primary">
            {{ source().invoice_number }}
            <span class="font-normal text-text-secondary">
              · {{ source().customer_name || 'Consumidor final' }}
            </span>
          </p>
          <p class="text-xs text-text-secondary">
            Total facturado: {{ money(source().total_amount) }}
          </p>
          @if (!source().cufe) {
            <p class="mt-1 flex items-start gap-1.5 text-xs text-warning">
              <app-icon name="alert-triangle" [size]="13" class="mt-0.5 shrink-0" />
              <span>
                Esta factura no tiene CUFE registrado. La nota se creará, pero al
                transmitirla el backend la rechazará: una nota exige la factura
                original aceptada y con clave fiscal.
              </span>
            </p>
          }
        </div>

        <form [formGroup]="noteForm" class="space-y-4">
          <!-- ── CONCEPTO DE CORRECCIÓN ──────────────────────────────────── -->
          <app-selector
            label="Concepto de corrección (DIAN)"
            formControlName="conceptCode"
            [options]="conceptOptions()"
            [searchable]="true"
            [required]="true"
            [disabled]="submitting() || !!createdNote()"
            placeholder="¿Por qué se corrige la factura?"
            [helpText]="conceptHelp()"
          ></app-selector>

          <div class="rounded-lg border border-info/30 bg-info-light p-3 text-xs text-text-secondary">
            {{ conceptGuidance }}
          </div>

          <div>
            <app-textarea
              label="Motivo"
              formControlName="reason"
              [rows]="3"
              [required]="true"
              [disabled]="submitting() || !!createdNote()"
              placeholder="Explica qué pasó: qué se devolvió, qué se ajustó, por qué."
            ></app-textarea>
            <!--
              Orquestador, 2026-08-25: este mismo texto alimenta DOS campos
              del documento (ver «buildNotePayload»), y quien escribe aquí no
              tiene forma de saberlo sin este aviso: el motivo declarado ante
              la DIAN (corto, 500) y las notas completas de la nota (largo,
              5.000). El tope de abajo es el del campo CORTO porque es el que
              de verdad limita lo que se puede escribir — el largo nunca
              recorta más de lo que el corto ya permitió.
            -->
            <p class="mt-1 text-[11px] leading-snug text-text-secondary">
              Este texto queda como el motivo declarado ante la DIAN (máx. 500
              caracteres) y, sin recortarse más, también como las notas
              completas de la nota. No hay un campo aparte para un motivo más
              largo.
            </p>
            <!--
              «app-textarea» no reenvía «maxlength» al «textarea» nativo, así
              que este contador es la única señal en pantalla del tope real
              (500) — lo hace cumplir «Validators.maxLength» en el formulario,
              no el navegador cortando el tecleo.
            -->
            @if (showCharCounter(noteForm.get('reason')!.value, reasonLimit)) {
              <p
                class="text-[10px] text-right leading-tight"
                [class.text-destructive]="
                  remainingChars(noteForm.get('reason')!.value, reasonLimit) <= 0
                "
                [class.text-text-secondary]="
                  remainingChars(noteForm.get('reason')!.value, reasonLimit) > 0
                "
              >
                {{ remainingChars(noteForm.get('reason')!.value, reasonLimit) }}
                caracteres restantes
              </p>
            }
            <!--
              F.3 reabierta: contador en rojo y botón apagado no explican NADA.
              Cuando el control viola el tope, este aviso nombra el campo y la
              cifra exacta, para que el recorte se entienda escribiendo y no
              como un formulario que «no hace nada» al pedir Crear.
            -->
            @if (reasonExceeded()) {
              <p class="text-[11px] text-error" role="alert">
                El campo Motivo supera su tope de {{ reasonLimit }} caracteres
                (tope DIAN del reason declarado). Recórtalo para crear la nota.
              </p>
            }
          </div>

          @if (reasonPreview(); as preview) {
            <div class="rounded-lg border border-border bg-surface-secondary/40 px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-text-secondary">
                Quedará registrado como
              </p>
              <p class="break-words text-xs text-text-primary">{{ preview }}</p>
            </div>
          }
        </form>

        <!-- ── ALCANCE: TOTAL O PARCIAL ─────────────────────────────────── -->
        <div>
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            Alcance de la corrección
          </p>
          <div class="flex gap-2" role="group" aria-label="Alcance de la nota">
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              [disabled]="submitting() || !!createdNote()"
              [ngClass]="
                scope() === 'total'
                  ? 'border-primary bg-primary/10 text-text-primary'
                  : 'border-border bg-[var(--color-surface)] text-text-primary'
              "
              [attr.aria-pressed]="scope() === 'total'"
              (click)="setScope('total')"
            >
              <span class="font-medium">Nota total</span>
              <span class="block text-[11px] text-text-secondary">
                Copia todas las líneas de la factura
              </span>
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
              [disabled]="submitting() || !!createdNote()"
              [ngClass]="
                scope() === 'partial'
                  ? 'border-primary bg-primary/10 text-text-primary'
                  : 'border-border bg-[var(--color-surface)] text-text-primary'
              "
              [attr.aria-pressed]="scope() === 'partial'"
              (click)="setScope('partial')"
            >
              <span class="font-medium">Nota parcial</span>
              <span class="block text-[11px] text-text-secondary">
                Elige líneas y cantidades
              </span>
            </button>
          </div>
        </div>

        @if (scope() === 'total' && contextError()) {
          <div class="rounded-lg border border-error bg-error-light p-3" role="alert">
            <p class="text-sm text-error">No se pudieron consultar los saldos de líneas para una nota parcial. La nota total copia la factura de origen y el servidor validará su creación.</p>
            @for (detail of contextErrorDetails(); track detail) { <p class="text-xs text-error">{{ detail }}</p> }
            <button type="button" class="mt-2 min-h-11 rounded-lg border border-error px-3 text-sm text-error" (click)="retryContext()">Reintentar consulta parcial</button>
          </div>
        }

        @if (scope() === 'partial') {
          @if (contextLoading()) {
            <p class="rounded-lg border border-border p-4 text-sm text-text-secondary" role="status">
              Cargando saldos y valores de origen…
            </p>
          } @else if (contextError()) {
            <div class="rounded-lg border border-error bg-error-light p-3" role="alert">
              <p class="text-sm font-semibold text-error">No se pudo cargar el contexto de la nota</p>
              <p class="text-sm text-error">{{ contextError() }}</p>
              @if (contextErrorDetails().length) {
                <ul class="mt-1 list-disc pl-4 text-xs text-error">
                  @for (detail of contextErrorDetails(); track detail) { <li>{{ detail }}</li> }
                </ul>
              }
              <button type="button" class="mt-2 min-h-11 rounded-lg border border-error px-3 text-sm text-error focus-visible:outline focus-visible:outline-2" (click)="retryContext()">
                Reintentar
              </button>
            </div>
          } @else {
            @if (noteContext()?.warnings?.length) {
              <div class="rounded-lg border border-warning bg-warning-light p-3" role="status">
                <p class="text-sm font-semibold text-warning">Revisa el origen antes de continuar</p>
                <ul class="mt-1 list-disc pl-4 text-xs text-warning">
                  @for (warning of noteContext()!.warnings; track warning) { <li>{{ warning }}</li> }
                </ul>
              </div>
            }
            <p class="text-xs text-text-secondary">Estimación únicamente: el servidor calcula el resultado final con los datos capturados de la factura.</p>
            <div class="space-y-3">
              @for (row of rows(); track row.item.id) {
                <article class="rounded-xl border border-border bg-[var(--color-surface)] p-3" [attr.data-source-id]="row.item.id">
                  <div class="flex items-start gap-3">
                    <input type="checkbox" class="mt-1 h-5 w-5 accent-[var(--color-primary)]" [checked]="row.selected" [disabled]="submitting() || !!createdNote()" [attr.aria-label]="'Incluir ' + row.name" (change)="toggleLine(row.item, $event)" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-semibold text-text-primary">{{ row.name }}</p>
                      <p class="text-xs text-text-secondary">Origen {{ row.item.id }} · Facturado {{ row.maxQuantity }} {{ row.sourceUnit || 'unidad no informada' }}</p>
                      @if (row.taxSummary) { <p class="mt-1 text-xs text-text-secondary">Tributos de origen (no editables): {{ row.taxSummary }}</p> }
                      @if (row.remainingText) { <p class="mt-1 text-xs text-text-secondary">Saldo disponible: {{ row.remainingText }}</p> }
                  @if (row.selected && !row.sourceAvailable) {
                    <p class="mt-2 text-xs text-error" role="alert">No se pudo resolver una línea fiscal de origen para esta fila; no se enviará una selección ambigua.</p>
                  }
                    </div>
                  </div>
                  <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <app-input label="Cantidad a corregir" type="number" [min]="0.0001" [max]="row.quantityInputMax" [step]="0.0001" [disabled]="!row.selected || submitting() || !!createdNote()" [formControl]="lineControl(row.item.id, 'quantity')" (inputChange)="setLineValue(row.item, 'quantity', $event)" [error]="row.selected && row.quantityInvalid ? row.quantityError : undefined"></app-input>
                    <app-input label="Precio unitario de la nota" [currency]="true" [currencyDecimals]="2" [max]="9_999_999_999.99" [disabled]="!row.selected || submitting() || !!createdNote()" [formControl]="lineControl(row.item.id, 'unit_price')" (inputChange)="setLineValue(row.item, 'unit_price', $event)" [error]="row.selected && row.priceInvalid ? 'Ingresa un precio entre 0 y 9.999.999.999,99, con máximo 2 decimales.' : undefined"></app-input>
                    <app-input label="Descuento efectivo de la línea" [currency]="true" [currencyDecimals]="2" [max]="row.discountMax" [disabled]="!row.selected || submitting() || !!createdNote()" [formControl]="lineControl(row.item.id, 'discount_amount')" (inputChange)="setLineValue(row.item, 'discount_amount', $event)" [helperText]="row.discountOverridden ? 'Valor editado; reemplaza el descuento efectivo sugerido.' : 'Valor sugerido desde la factura y ajustado a la cantidad.'" [error]="row.selected && row.discountError ? row.discountError : undefined"></app-input>
                    <app-selector label="Unidad de medida" [options]="row.unitOptions" [formControl]="lineControl(row.item.id, 'unit_code')" [disabled]="!row.selected || submitting() || !!createdNote()" [required]="true" placeholder="Selecciona la unidad" (valueChange)="setUnitCode(row.item, $event)" [errorText]="row.selected && !row.unitCode ? 'Selecciona una unidad para esta línea.' : ''"></app-selector>
                  </div>
                  @if (row.selected && row.remainingQuantity !== null && noteType() === 'credit' && row.quantity > row.remainingQuantity) {
                    <p class="mt-2 text-xs text-error" role="alert">La cantidad supera el saldo de {{ row.remainingQuantity }} {{ row.sourceUnit || '' }} disponible para esta línea.</p>
                  }
                  <div class="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-xs">
                    <span class="text-text-secondary">Estimación: {{ money(row.total) }} · Tributos en la estimación: {{ money(row.taxAmount) }}</span>
                    @if (row.selected && row.invalidDiscount) { <span class="text-error" role="alert">El descuento no puede superar la base de la línea.</span> }
                  </div>
                </article>
              } @empty {
                <p class="rounded-lg border border-border p-4 text-center text-sm text-text-secondary">La factura no tiene líneas para corregir parcialmente.</p>
              }
            </div>
          }
        }

        <!-- ── TOTALES DE LA NOTA ─────────────────────────────────────────
             Se pintan también en la nota TOTAL: saber por cuánto va a salir el
             documento antes de emitirlo es justo lo que evita descubrirlo
             cuando ya gastó un consecutivo. -->
        <div class="rounded-xl border border-border bg-surface-secondary/40 p-3">
          <div class="space-y-1 text-sm">
            <div class="flex justify-between">
              <span class="text-text-secondary">Subtotal</span>
              <span class="text-text-primary">{{ money(totals().subtotal) }}</span>
            </div>
            @if (totals().discount > 0) {
              <div class="flex justify-between">
                <span class="text-text-secondary">Descuentos</span>
                <span class="text-error">−{{ money(totals().discount) }}</span>
              </div>
            }
            <div class="flex justify-between">
              <span class="text-text-secondary">Impuestos</span>
              <span class="text-text-primary">{{ money(totals().tax) }}</span>
            </div>
          </div>
          <div
            class="mt-2 flex items-baseline justify-between border-t border-border pt-2"
          >
            <span class="text-sm font-semibold text-text-primary">
              Total de la {{ noteNoun() }}
            </span>
            <span class="text-lg font-bold text-primary">
              {{ money(totals().total) }}
            </span>
          </div>
        </div>

        <!-- La nota nace en BORRADOR. Decirlo evita que el comerciante crea que
             ya corrigió la factura ante la DIAN y se entere semanas después. -->
        <div class="flex items-start gap-2.5 rounded-lg border border-border p-3">
          <app-icon name="info" [size]="16" class="mt-0.5 shrink-0 text-text-secondary" />
          <p class="text-xs text-text-secondary">
            La nota se crea en <strong>borrador</strong> y consume un consecutivo
            de la resolución de {{ noteNoun() }}s. Todavía no queda ante la DIAN:
            hay que validarla y enviarla desde su propio detalle.
          </p>
        </div>

        <!-- B.1 — la nota ya nació: preguntar si se emite de una. El
             formulario queda arriba intacto pero el pie ya no ofrece Crear,
             así que no hay doble nota por doble clic. -->
        @if (createdNote(); as note) {
          <div class="rounded-xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 p-3">
            <p class="text-sm font-semibold text-text-primary">
              {{ note.invoice_number }} creada en borrador por {{ money(note.total_amount) }}
            </p>
            <p class="mt-1 text-xs text-text-secondary">
              ¿Desea emitirla ahora? Se valida y se envía a la DIAN de una vez.
              Si elige Después, queda en borrador y se emite desde su detalle.
            </p>
            @if (issueError()) {
              <p class="mt-2 text-xs font-semibold text-error">{{ issueError() }}</p>
            }
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <app-button
                variant="ghost"
                [disabled]="issuing()"
                (clicked)="onIssueLater()"
              >
                Después
              </app-button>
              <app-button
                variant="primary"
                [loading]="issuing()"
                [disabled]="issuing()"
                (clicked)="onIssueNow()"
              >
                Emitir ahora
              </app-button>
            </div>
          </div>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        @if (createdNote()) {
          <span class="text-xs text-text-secondary self-center">
            Responda arriba: emitir ahora o dejarla en borrador.
          </span>
        } @else {
          <app-button variant="ghost" (clicked)="onClose()">Cancelar</app-button>
          <app-button
            variant="primary"
            [loading]="submitting()"
            [disabled]="!canSubmit()"
            (clicked)="onSubmit()"
          >
            Crear {{ noteNoun() }}
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class InvoiceNoteCreateComponent {
  readonly isOpen = model<boolean>(false);
  readonly invoice = input.required<Invoice>();
  /**
   * `model()` y no `input()`: el detalle abre el modal ya en «crédito» o en
   * «débito» según el botón que se pulsó, pero el usuario puede cambiar de
   * idea dentro del modal y el padre tiene que enterarse — si no, reabrir
   * volvería al tipo viejo.
   */
  readonly noteType = model<'credit' | 'debit'>('credit');

  private readonly fb = inject(FormBuilder);
  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);
  private readonly invoicing = inject(InvoicingService);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitErrorCode = signal<string | null>(null);
  readonly submitErrorDetails = signal<string[]>([]);
  /**
   * Nota recién creada, a la espera de la pregunta "¿Emitirla ahora?"
   * (CP-nc-nd-auto-orden-reembolso, B.1). Mientras no sea null el formulario
   * queda detrás del panel de emisión: evita crear dos notas con doble clic.
   */
  readonly createdNote = signal<Invoice | null>(null);
  readonly issuing = signal(false);
  readonly issueError = signal<string | null>(null);
  readonly scope = signal<'total' | 'partial'>('total');
  readonly noteContext = signal<InvoiceNoteContext | null>(null);
  readonly conceptGuidance = NOTE_CONCEPT_GUIDANCE;
  readonly contextLoading = signal(false);
  readonly contextError = signal<string | null>(null);
  readonly contextErrorDetails = signal<string[]>([]);
  private readonly contextRetry = signal(0);
  private preserveLineStateOnContextRefresh = false;
  private preserveContextKey: string | null = null;
  private lastContextIdentity: string | null = null;
  private pendingCreate: PendingNoteCreate | null = null;

  /**
   * Selección por línea, indexada por `invoice_items.id`.
   *
   * Signal y no `FormArray`: los controles por línea viven juntos en un objeto
   * indexado por origen; reemplazar la entrada activa los `computed` que
   * construyen selección, estimación y validación.
   */
  private readonly lineState = signal<Record<number, NoteLineState>>({});

  readonly noteForm = this.fb.group({
    conceptCode: ['', Validators.required],
    reason: [
      '',
      [Validators.required, Validators.minLength(5), Validators.maxLength(NOTE_REASON_LIMIT)],
    ],
  });

  /**
   * Orquestador, 2026-08-25 (corrección sobre F.3/defecto 2): este control
   * es el ÚNICO textarea que alimenta a la vez `reason` (500,
   * `cac:DiscrepancyResponse/cbc:Description`) y `notes` (5.000,
   * `cbc:Note` del documento) vía `buildNotePayload`. El contador y el
   * `Validators.maxLength` de arriba tienen que medir contra el más CORTO
   * de los dos: si se midiera contra `NOTE_TEXT_LIMIT` (5.000), el usuario
   * ve «quedan 4.200» y escribe tranquilo, y `buildNoteReason` recorta su
   * motivo a 500 en silencio al guardar — exactamente el defecto que esto
   * reemplaza. Con el tope en 500, un texto más largo queda el formulario
   * inválido, no aceptado-y-luego-cortado.
   */
  readonly reasonLimit = NOTE_REASON_LIMIT;

  /**
   * F.3 reabierta (2026-08-25): con el contador ya medido contra el tope real
   * (500), quedaba la otra mitad del defecto — pasarse de largo sólo producía
   * un contador en rojo y un botón «Crear» deshabilitado sin explicación.
   * Este computed alimenta el aviso que nombra el campo y la cifra.
   *
   * Se lee desde `formValue()` —el toSignal de `valueChanges`— y NO desde
   * `noteForm.value`: la propiedad plana se congela en el estado inicial
   * dentro de un `computed` y el aviso nunca aparecería (mismo defecto que
   * el docblock de `formValue` documenta para el botón).
   */
  readonly reasonExceeded = computed(() => {
    const value = this.formValue().reason ?? '';
    return value.length > NOTE_REASON_LIMIT;
  });

  readonly remainingChars = remainingChars;
  readonly showCharCounter = showCharCounter;

  /**
   * `noteForm.value` y `.status` son propiedades planas: leerlas dentro de un
   * `computed` las congela en el estado inicial y el botón «Crear» se queda
   * apagado para siempre. Se puentean a signals.
   */
  private readonly formValue = toSignal(
    this.noteForm.valueChanges.pipe(startWith(this.noteForm.value)),
    { initialValue: this.noteForm.value },
  );
  private readonly formStatus = toSignal(
    this.noteForm.statusChanges.pipe(startWith(this.noteForm.status)),
    { initialValue: this.noteForm.status },
  );

  readonly source = computed<Invoice>(() => this.invoice());

  readonly noteNoun = computed(() =>
    this.noteType() === 'credit' ? 'nota crédito' : 'nota débito',
  );

  readonly title = computed(() =>
    this.noteType() === 'credit'
      ? 'Nueva nota crédito'
      : 'Nueva nota débito',
  );

  readonly subtitle = computed(
    () => 'Corrige la factura ' + this.source().invoice_number,
  );

  readonly conceptOptions = computed<SelectorOption[]>(() =>
    noteConcepts(this.noteType()).map((concept) => ({
      value: concept.code,
      label: concept.code + ' · ' + concept.label,
      description: concept.hint,
    })),
  );

  readonly conceptHelp = computed(() =>
    this.noteType() === 'credit'
      ? 'Tabla 13.2.4 del Anexo Técnico 1.9 (ConceptoNotaCredito).'
      : 'Tabla 13.2.5 del Anexo Técnico 1.9 (ConceptoNotaDebito).',
  );

  private readonly conceptCode = computed(
    () => this.formValue().conceptCode?.trim() ?? '',
  );

  private readonly concept = computed(() =>
    findNoteConcept(this.noteType(), this.conceptCode()),
  );

  readonly reasonPreview = computed<string | null>(() => {
    const chosen = this.concept();
    const reason = this.formValue().reason?.trim() ?? '';
    if (!chosen || !reason) {
      return null;
    }
    return buildNoteReason(chosen.code, chosen.label, reason);
  });

  /** Card rows use only captured context and local editable values. */
  readonly rows = computed(() => {
    const state = this.lineState();
    const context = this.noteContext();
    return invoiceLines(this.source()).map((item) => {
      const entry = state[item.id];
      const selected = entry?.selected ?? false;
      const quantity = entry?.quantity ?? num(item.quantity);
      const maxQuantity = num(item.quantity);
      const sourceContext = context?.items.find((line) => line.source_invoice_item_id === item.id);
      const unitPrice = entry?.unit_price ?? num(sourceContext?.unit_price ?? item.unit_price);
      const discount = entry?.discount_amount ?? num(sourceContext?.discount_amount ?? item.discount_amount);
      const unitCode = entry?.unit_code ?? sourceContext?.unit_code ?? item.unit_code ?? '';
      const scaled = estimateLine({
        item,
        quantity: selected ? quantity : 0,
        unit_price: unitPrice,
        ...(selected && entry?.discount_overridden ? { discount_amount: discount } : {}),
        discount_overridden: entry?.discount_overridden ?? false,
        unit_code: unitCode,
        ...(sourceContext ? { context: sourceContext } : {}),
      });
      const divisor = num(sourceContext?.price_unit_quantity ?? item.price_unit_quantity) || 1;
      const remainingQuantity = sourceContext?.remaining_quantity === null || sourceContext?.remaining_quantity === undefined
        ? null
        : num(sourceContext.remaining_quantity);
      const quantityLimit = this.noteType() === 'credit'
        ? (remainingQuantity ?? maxQuantity)
        : null;
      const quantityInputMax = this.noteType() === 'credit'
        ? Math.min(quantityLimit ?? maxQuantity, 99_999_999.9999)
        : 99_999_999.9999;
      const discountMax = Math.max(0, Math.min(9_999_999_999.99, (quantity * unitPrice) / divisor));
      const overCreditQuantity = this.noteType() === 'credit' && quantity > (quantityLimit ?? maxQuantity);
      const quantityInvalid = !Number.isFinite(quantity) || quantity < 0.0001 || decimalPlaces(quantity) > 4 ||
        quantity > 99_999_999.9999 || overCreditQuantity;
      const priceInvalid = !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 9_999_999_999.99 || decimalPlaces(unitPrice) > 2;
      const discountError = selected && (!Number.isFinite(discount) || discount < 0 || discount > 9_999_999_999.99 || decimalPlaces(discount) > 2 || discount > (quantity * unitPrice) / divisor);
      const remainingText = sourceContext
        ? [remainingQuantity !== null ? `${remainingQuantity} ${unitCode}` : null,
            sourceContext.remaining_base != null ? `base ${this.money(sourceContext.remaining_base)}` : null,
            sourceContext.remaining_total != null ? `total ${this.money(sourceContext.remaining_total)}` : null]
          .filter(Boolean).join(' · ')
        : '';
      const taxSummary = sourceContext?.taxes.map((tax) =>
        `${tax.tax_name} ${tax.tax_rate}${tax.rate_basis === 'percent' ? '%' : tax.rate_basis === 'per_mil' ? '‰' : ''}${tax.is_inclusive ? ' incluido' : ' adicional'}`,
      ).join(' · ') ?? '';
      return {
        item,
        name: sourceContext?.description || item.product_name || item.description || 'Línea sin descripción',
        selected,
        quantity,
        maxQuantity,
        quantityLimit,
        quantityInputMax,
        discountMax,
        overMax: selected && overCreditQuantity,
        quantityInvalid,
        quantityError: quantityLimit === 0
          ? 'No queda cantidad acreditable disponible en esta línea.'
          : overCreditQuantity
            ? `Máximo disponible: ${quantityLimit ?? maxQuantity}.`
            : decimalPlaces(quantity) > 4
              ? 'La cantidad admite hasta 4 decimales.'
              : quantity > 99_999_999.9999
                ? 'La cantidad debe estar entre 0,0001 y 99.999.999,9999.'
              : 'La cantidad mínima es 0,0001.',
        priceInvalid,
        discountError: discountError
          ? `El descuento debe estar entre 0 y ${this.money(discountMax)} y admitir hasta 2 decimales.`
          : '',
        invalidDiscount: Boolean(discountError),
        discountOverridden: entry?.discount_overridden ?? false,
        unitCode,
        sourceUnit: sourceContext?.unit_code ?? item.unit_code ?? null,
        sourceAvailable: Boolean(sourceContext),
        remainingQuantity,
        remainingText,
        taxSummary,
        unitOptions: this.unitOptions(sourceContext?.unit_code ?? item.unit_code ?? null),
        taxAmount: scaled.tax_amount,
        total: scaled.total,
      };
    });
  });

  /**
   * Lo que de verdad se va a mandar.
   *
   * Total-note inputs are omitted; partial selections contain only captured
   * source context and the four editable commercial values.
   */
  readonly selections = computed<NoteLineSelection[]>(() => {
    const lines = invoiceLines(this.source());
    const context = this.noteContext();
    if (this.scope() === 'total') {
      return lines.map((item) => {
        const entry = this.lineState()[item.id];
        const sourceContext = context?.items.find((line) => line.source_invoice_item_id === item.id);
        return {
          item,
          quantity: num(item.quantity),
          unit_price: entry?.unit_price ?? num(sourceContext?.unit_price ?? item.unit_price),
          discount_amount: entry?.discount_amount ?? num(sourceContext?.discount_amount ?? item.discount_amount),
          unit_code: entry?.unit_code ?? sourceContext?.unit_code ?? item.unit_code ?? undefined,
          ...(sourceContext ? { context: sourceContext } : {}),
        };
      });
    }
    const state = this.lineState();
    return lines
      .map((item) => {
        const entry = state[item.id];
        return {
          item,
          quantity: entry?.selected ? entry.quantity : 0,
          unit_price: entry?.unit_price,
          ...(entry?.discount_overridden ? { discount_amount: entry.discount_amount } : {}),
          discount_overridden: entry?.discount_overridden ?? false,
          unit_code: entry?.unit_code,
          ...(context?.items.find((line) => line.source_invoice_item_id === item.id)
            ? { context: context.items.find((line) => line.source_invoice_item_id === item.id)! }
            : {}),
        };
      })
      .filter((selection) => selection.quantity >= 0.0001);
  });

  readonly totals = computed(() => {
    if (this.scope() === 'total') {
      const source = this.source();
      return {
        subtotal: num(source.subtotal_amount), discount: num(source.discount_amount),
        tax: num(source.tax_amount), total: num(source.total_amount),
      };
    }
    return noteTotals(this.selections());
  });

  private readonly hasInvalidLine = computed(() => this.rows().some((row) =>
    row.selected && (row.quantityInvalid || row.priceInvalid || row.invalidDiscount || !row.unitCode ||
      !this.noteContext()?.items.some((line) => line.source_invoice_item_id === row.item.id)),
  ));

  readonly canSubmit = computed(() => {
    if (this.submitting() || this.formStatus() !== 'VALID') {
      return false;
    }
    if (this.scope() === 'partial') {
      return !this.contextLoading() && !this.contextError() && Boolean(this.noteContext()) &&
        this.selections().length > 0 && !this.hasInvalidLine();
    }
    return invoiceLines(this.source()).length > 0;
  });

  constructor() {
    this.currency.loadCurrency();

    /**
     * Abrir el modal —o cambiarle la factura— reinicia la selección de líneas.
     *
     * Sin esto, abrir una segunda factura arrastraría las cantidades tecleadas
     * para la primera, indexadas por unos `invoice_items.id` que ya no existen
     * en el documento visible. Escribe `lineState` pero no lo lee: no hay ciclo.
     */
    effect((onCleanup) => {
      const open = this.isOpen();
      const invoice = this.invoice();
      const noteType = this.noteType() === 'credit' ? 'credit_note' : 'debit_note';
      this.contextRetry();
      const contextKey = `${invoice?.id ?? ''}:${noteType}`;
      const preserveLineState = this.preserveLineStateOnContextRefresh && this.preserveContextKey === contextKey;
      this.preserveLineStateOnContextRefresh = false;
      this.preserveContextKey = null;
      if (!open || !invoice) {
        if (this.lastContextIdentity !== null) untracked(() => this.reset());
        this.lastContextIdentity = null;
        this.contextLoading.set(false);
        return;
      }
      if (this.lastContextIdentity !== contextKey && !preserveLineState) {
        untracked(() => this.reset());
      }
      this.lastContextIdentity = contextKey;
      if (!preserveLineState) this.lineState.set({});
      this.noteContext.set(null);
      this.contextError.set(null);
      this.contextErrorDetails.set([]);

      this.contextLoading.set(true);
      const request = this.invoicing.getInvoiceNoteContext(invoice.id, noteType).subscribe({
        next: (response) => {
          this.noteContext.set(response.data);
          if (!preserveLineState) {
            const contextBySource = new Map(response.data.items.map((line) => [line.source_invoice_item_id, line]));
            const nextState: Record<number, NoteLineState> = {};
            for (const item of invoiceLines(invoice)) {
              const source = contextBySource.get(item.id);
              const quantity = num(source?.quantity ?? item.quantity);
              const unitPrice = num(source?.unit_price ?? item.unit_price);
              const discount = num(source?.discount_amount ?? item.discount_amount);
              const unitCode = source?.unit_code ?? item.unit_code ?? '';
              nextState[item.id] = this.createLineState({ quantity, unitPrice, discount, unitCode });
            }
            this.lineState.set(nextState);
          } else {
            this.clearSubmitError();
          }
          this.contextLoading.set(false);
        },
        error: (error: unknown) => {
          const failure = describeApiFailure(error);
          this.contextError.set(failure.message);
          this.contextErrorDetails.set(describeNoteIntegrityDetails(failure.errorCode, failure.details));
          this.contextLoading.set(false);
        },
      });
      onCleanup(() => request.unsubscribe());
    });

    this.actions$
      .pipe(
        ofType(createCreditNoteSuccess, createDebitNoteSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ invoice }) => this.onSucceeded(invoice));

    this.actions$
      .pipe(
        ofType(createCreditNoteFailure, createDebitNoteFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((failure) => this.onFailed(failure));

    this.actions$
      .pipe(ofType(issueNoteSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ invoice }) => this.onIssued(invoice.id));

    this.actions$
      .pipe(ofType(issueNoteFailure), takeUntilDestroyed(this.destroyRef))
      .subscribe((failure) => this.onIssueFailed(failure));
  }

  money(value: number | string | null | undefined): string {
    return this.currency.format(num(value));
  }

  setNoteType(type: 'credit' | 'debit'): void {
    if (this.submitting() || this.createdNote() || this.noteType() === type) {
      return;
    }
    this.noteType.set(type);
    // Los catálogos son distintos: arrastrar el código elegido para el otro
    // tipo declararía «Intereses» donde el usuario había elegido «Anulación».
    this.noteForm.controls.conceptCode.setValue('');
    this.scope.set('total');
    this.createdNote.set(null);
    this.noteContext.set(null);
    this.lineState.set({});
    this.clearSubmitError();
  }

  setScope(scope: 'total' | 'partial'): void {
    if (this.submitting() || this.createdNote()) {
      return;
    }
    this.scope.set(scope);
    this.clearSubmitError();
  }

  toggleLine(item: InvoiceItem, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const existing = this.lineState()[item.id] ?? this.createLineState({
      quantity: num(item.quantity), unitPrice: num(item.unit_price),
      discount: num(item.discount_amount), unitCode: item.unit_code ?? '',
    });
    let quantity = existing.quantity;
    let discount = existing.discount_amount;
    if (checked && this.noteType() === 'credit') {
      const source = this.noteContext()?.items.find((line) => line.source_invoice_item_id === item.id);
      const remaining = source?.remaining_quantity;
      if (remaining != null) quantity = Math.min(quantity, num(remaining));
      if (!existing.discount_overridden) {
        const sourceQuantity = num(source?.quantity ?? item.quantity);
        discount = sourceQuantity > 0
          ? round2(num(source?.discount_amount ?? item.discount_amount) * quantity / sourceQuantity)
          : 0;
      }
      existing.controls.quantity.setValue(quantity, { emitEvent: false });
      existing.controls.discount_amount.setValue(discount, { emitEvent: false });
    }
    this.lineState.update((state) => ({
      ...state,
      [item.id]: {
        ...existing,
        selected: checked,
        quantity,
        discount_amount: discount,
      },
    }));
  }

  lineControl(itemId: number, field: 'unit_code'): FormControl<string>;
  lineControl(itemId: number, field: 'quantity' | 'unit_price' | 'discount_amount'): FormControl<number>;
  lineControl(itemId: number, field: keyof NoteLineState['controls']): FormControl<number> | FormControl<string> {
    const state = this.lineState()[itemId];
    if (state) return state.controls[field] as FormControl<number> | FormControl<string>;
    return (field === 'unit_code'
      ? new FormControl('', { nonNullable: true })
      : new FormControl(0, { nonNullable: true })) as FormControl<number> | FormControl<string>;
  }

  setLineValue(item: InvoiceItem, field: 'quantity' | 'unit_price' | 'discount_amount', raw: string): void {
    const parsed = raw.trim() === '' ? 0 : Number(raw);
    const value = Number.isFinite(parsed) ? parsed : 0;
    const old = this.lineState()[item.id] ?? this.createLineState({
      quantity: num(item.quantity), unitPrice: num(item.unit_price),
      discount: num(item.discount_amount), unitCode: item.unit_code ?? '',
    });
    const patch: Partial<NoteLineState> = { [field]: value };
    if (field === 'discount_amount') patch.discount_overridden = true;
    if (field === 'quantity' && !old.discount_overridden) {
      const contextLine = this.noteContext()?.items.find((line) => line.source_invoice_item_id === item.id);
      const originalQuantity = num(contextLine?.quantity ?? item.quantity);
      const proratedDiscount = originalQuantity > 0
        ? round2((num(contextLine?.discount_amount ?? item.discount_amount) * value) / originalQuantity)
        : 0;
      patch.discount_amount = proratedDiscount;
      old.controls.discount_amount.setValue(proratedDiscount, { emitEvent: false });
    }
    this.lineState.update((state) => ({
      ...state,
      [item.id]: {
        ...old,
        ...patch,
        selected: true,
      },
    }));
  }

  setUnitCode(item: InvoiceItem, code: string | number | null): void {
    const old = this.lineState()[item.id];
    if (!old || typeof code !== 'string') return;
    old.controls.unit_code.setValue(code, { emitEvent: false });
    this.lineState.update((state) => ({ ...state, [item.id]: { ...old, unit_code: code } }));
  }

  retryContext(): void {
    this.preserveLineStateOnContextRefresh = Object.keys(this.lineState()).length > 0;
    this.preserveContextKey = this.preserveLineStateOnContextRefresh
      ? `${this.invoice().id}:${this.noteType() === 'credit' ? 'credit_note' : 'debit_note'}`
      : null;
    this.contextRetry.update((value) => value + 1);
  }

  private createLineState(values: { quantity: number; unitPrice: number; discount: number; unitCode: string }): NoteLineState {
    return {
      selected: false,
      quantity: values.quantity,
      unit_price: values.unitPrice,
      discount_amount: round2(values.discount),
      unit_code: values.unitCode,
      discount_overridden: false,
      controls: {
        quantity: new FormControl(values.quantity, { nonNullable: true }),
        unit_price: new FormControl(values.unitPrice, { nonNullable: true }),
        discount_amount: new FormControl(values.discount, { nonNullable: true }),
        unit_code: new FormControl(values.unitCode, { nonNullable: true }),
      },
    };
  }

  private unitOptions(sourceUnit: string | null): SelectorOption[] {
    if (!sourceUnit || UNIT_CODE_OPTIONS.some((option) => option.value === sourceUnit)) return UNIT_CODE_OPTIONS;
    return [...UNIT_CODE_OPTIONS, { value: sourceUnit, label: `${sourceUnit} (unidad original)` }];
  }

  onSubmit(): void {
    if (!this.canSubmit()) {
      this.noteForm.markAllAsTouched();
      return;
    }
    const chosen = this.concept();
    if (!chosen) {
      return;
    }

    this.clearSubmitError();
    this.submitting.set(true);
    const dto = buildNotePayload({
      invoice: this.source(),
      scope: this.scope(),
      conceptCode: chosen.code,
      conceptLabel: chosen.label,
      reason: this.formValue().reason ?? '',
      selections: this.selections(),
    });
    this.pendingCreate = {
      relatedInvoiceId: this.source().id,
      invoiceType: this.noteType() === 'credit' ? 'credit_note' : 'debit_note',
    };
    this.noteForm.disable();

    this.store.dispatch(
      this.noteType() === 'credit'
        ? createCreditNote({ dto })
        : createDebitNote({ dto }),
    );
  }

  /**
   * La nota nació en borrador: NO se cierra ni se limpia — se muestra la
   * pregunta "¿Emitirla ahora?" (B.1). El cierre llega con `onIssued()` o con
   * "Después".
   */
  private onSucceeded(invoice: Invoice): void {
    const pending = this.pendingCreate;
    const result = invoice as Invoice & { related_invoice_id?: number | null };
    if (!this.submitting() || !pending ||
      result.related_invoice_id !== pending.relatedInvoiceId ||
      invoice.invoice_type !== pending.invoiceType) {
      return;
    }
    this.pendingCreate = null;
    this.submitting.set(false);
    this.clearSubmitError();
    this.issueError.set(null);
    this.createdNote.set(invoice);
  }

  /** Un clic: validar + enviar la nota recién creada vía `POST :id/issue`. */
  onIssueNow(): void {
    const note = this.createdNote();
    if (!note || this.issuing()) {
      return;
    }
    this.issueError.set(null);
    this.issuing.set(true);
    this.store.dispatch(issueNote({ id: note.id }));
  }

  /** Dejar la nota en borrador y cerrar, como hacía el flujo manual. */
  onIssueLater(): void {
    if (this.issuing()) {
      return;
    }
    this.reset();
    this.isOpen.set(false);
  }

  private onIssued(issuedId: number): void {
    // La página de orden emite sus propias notas (B.3) sobre el mismo store:
    // solo la que este modal pidió lo cierra.
    if (this.createdNote()?.id !== issuedId) {
      return;
    }
    this.issuing.set(false);
    this.reset();
    this.isOpen.set(false);
  }

  private onIssueFailed(failure: MutationFailure): void {
    if (!this.createdNote() || !this.issuing()) {
      return;
    }
    this.issuing.set(false);
    this.issueError.set(failure.error);
  }

  /**
   * El backend rechazó la nota: el modal sigue abierto con lo ya escrito.
   *
   * Los mensajes se extraen con el MISMO util que usa el resto del módulo
   * (`extractValidationMessages`), que sabe desanidar el `details` del
   * `ValidationPipe` global. `MutationFailure.details` es `unknown` a propósito:
   * tratarlo como arreglo sin desanidar dejaba en pantalla un «[object Object]».
   */
  private onFailed(failure: MutationFailure): void {
    if (!this.submitting()) {
      return;
    }
    this.submitting.set(false);
    this.pendingCreate = null;
    this.noteForm.enable();
    this.submitError.set(failure.error);
    this.submitErrorCode.set(failure.errorCode ?? null);
    this.submitErrorDetails.set([
      ...extractValidationMessages(failure.details),
      ...describeNoteIntegrityDetails(failure.errorCode, failure.details),
    ]);
  }

  onClose(): void {
    if (this.submitting() || this.issuing()) {
      return;
    }
    // Cerrar con la pregunta pendiente equivale a "Después": la nota queda en
    // borrador y se emite desde su detalle, como antes de este cambio.
    this.reset();
    this.isOpen.set(false);
  }

  private reset(): void {
    this.noteForm.enable({ emitEvent: false });
    this.noteForm.reset({ conceptCode: '', reason: '' });
    this.scope.set('total');
    this.clearSubmitError();
    this.createdNote.set(null);
    this.issuing.set(false);
    this.issueError.set(null);
    this.lineState.set({});
    this.noteContext.set(null);
    this.contextError.set(null);
    this.contextErrorDetails.set([]);
    this.preserveLineStateOnContextRefresh = false;
    this.preserveContextKey = null;
    this.pendingCreate = null;
  }

  private clearSubmitError(): void {
    this.submitError.set(null);
    this.submitErrorCode.set(null);
    this.submitErrorDetails.set([]);
  }
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const decimal = text.split('.')[1];
  return decimal?.length ?? 0;
}
