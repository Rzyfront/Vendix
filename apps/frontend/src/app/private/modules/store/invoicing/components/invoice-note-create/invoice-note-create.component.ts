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
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';

import { Invoice, InvoiceItem } from '../../interfaces/invoice.interface';
import {
  createCreditNote,
  createCreditNoteFailure,
  createCreditNoteSuccess,
  createDebitNote,
  createDebitNoteFailure,
  createDebitNoteSuccess,
  MutationFailure,
} from '../../state/actions/invoicing.actions';
import { extractValidationMessages } from '../../utils/invoicing-errors.util';
import { findNoteConcept, noteConcepts } from './dian-note-concepts';
import {
  NOTE_REASON_LIMIT,
  NOTE_TEXT_LIMIT,
  NoteLineSelection,
  buildNotePayload,
  buildNoteReason,
  invoiceLines,
  lineTaxRate,
  noteTotals,
  num,
  scaleLine,
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
import { remainingChars, showCharCounter } from '../../utils/char-limit.util';

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
                    @for (detail of submitErrorDetails(); track detail) {
                      <li>{{ detail }}</li>
                    }
                  </ul>
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
            placeholder="¿Por qué se corrige la factura?"
            [helpText]="conceptHelp()"
          ></app-selector>

          <div>
            <app-textarea
              label="Motivo"
              formControlName="reason"
              [rows]="3"
              [required]="true"
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

        <!-- ── ALCANCE: TOTAL O PARCIAL ───────────────────────────────────
             Fuera del <form> a propósito. Las cantidades por línea son
             controles nativos con manejadores explícitos: meter un [(ngModel)]
             dentro de un formGroup dispara NG01350 y aborta la detección de
             cambios de todo el modal. -->
        <div>
          <p class="mb-1.5 text-xs font-medium text-text-secondary">
            Alcance de la corrección
          </p>
          <div class="flex gap-2" role="group" aria-label="Alcance de la nota">
            <button
              type="button"
              class="flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
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

        @if (scope() === 'partial') {
          <div class="rounded-lg border border-border">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border">
                    <th class="w-10 px-2 py-2"></th>
                    <th class="px-2 py-2 text-left font-medium text-text-secondary">
                      Línea
                    </th>
                    <th class="px-2 py-2 text-center font-medium text-text-secondary">
                      Facturado
                    </th>
                    <th class="px-2 py-2 text-center font-medium text-text-secondary">
                      A corregir
                    </th>
                    <th class="px-2 py-2 text-right font-medium text-text-secondary">
                      Impuestos
                    </th>
                    <th class="px-2 py-2 text-right font-medium text-text-secondary">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.item.id) {
                    <tr class="border-b border-border last:border-b-0">
                      <td class="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          class="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                          [checked]="row.selected"
                          [attr.aria-label]="'Incluir ' + row.name"
                          (change)="toggleLine(row.item, $event)"
                        />
                      </td>
                      <td class="px-2 py-2 align-top text-text-primary">
                        <span class="block">{{ row.name }}</span>
                        <span class="block text-xs text-text-secondary">
                          {{ money(row.item.unit_price) }} c/u
                          @if (row.rate > 0) {
                            <span> · {{ row.rate }}%</span>
                          }
                        </span>
                      </td>
                      <td class="px-2 py-2 text-center align-top text-text-secondary">
                        {{ row.maxQuantity }}
                      </td>
                      <td class="px-2 py-2 text-center align-top">
                        <input
                          type="number"
                          min="0"
                          [max]="row.maxQuantity"
                          step="any"
                          class="w-24 rounded-lg border border-border bg-[var(--color-surface)]
                                 px-2 py-1 text-right text-sm text-text-primary
                                 focus:border-[var(--color-primary)] focus:outline-none
                                 focus:ring-2 focus:ring-[var(--color-ring)]
                                 disabled:opacity-50"
                          [class.border-error]="row.overMax"
                          [value]="row.quantity"
                          [disabled]="!row.selected"
                          [attr.aria-label]="'Cantidad a corregir de ' + row.name"
                          (input)="setQuantity(row.item, $event)"
                        />
                        @if (row.overMax) {
                          <span class="block text-[11px] text-error">
                            Máx. {{ row.maxQuantity }}
                          </span>
                        }
                      </td>
                      <td class="px-2 py-2 text-right align-top text-text-secondary">
                        {{ money(row.taxAmount) }}
                      </td>
                      <td class="px-2 py-2 text-right align-top font-medium text-text-primary">
                        {{ money(row.total) }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="px-2 py-4 text-center text-text-secondary">
                        La factura no tiene líneas: no hay nada que corregir
                        parcialmente.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
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
      </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onClose()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="submitting()"
          [disabled]="!canSubmit()"
          (clicked)="onSubmit()"
        >
          Crear {{ noteNoun() }}
        </app-button>
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

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitErrorDetails = signal<string[]>([]);
  readonly scope = signal<'total' | 'partial'>('total');

  /**
   * Selección por línea, indexada por `invoice_items.id`.
   *
   * Signal y no `FormArray`: las cantidades se editan con `<input>` nativos
   * fuera del `formGroup` (ver el comentario del template), y un objeto plano
   * reemplazado entero es lo que hace que los `computed` de totales se
   * recalculen sin más ceremonia.
   */
  private readonly lineState = signal<
    Record<number, { selected: boolean; quantity: number }>
  >({});

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

  /** Las filas de la tabla parcial, ya con su aritmética resuelta. */
  readonly rows = computed(() => {
    const state = this.lineState();
    return invoiceLines(this.source()).map((item) => {
      const entry = state[item.id];
      const selected = entry?.selected ?? false;
      const quantity = entry?.quantity ?? num(item.quantity);
      const maxQuantity = num(item.quantity);
      const scaled = scaleLine(item, selected ? quantity : 0);
      return {
        item,
        name: item.product_name || item.description || 'Línea sin descripción',
        selected,
        quantity,
        maxQuantity,
        overMax: selected && quantity > maxQuantity,
        rate: lineTaxRate(item),
        taxAmount: scaled.tax_amount,
        total: scaled.total,
      };
    });
  });

  /**
   * Lo que de verdad se va a mandar.
   *
   * En «total» son TODAS las líneas a su cantidad original — no porque se vayan
   * a transmitir (una nota total omite `items` y deja que el backend las copie)
   * sino para poder mostrar el total del documento antes de crearlo.
   */
  readonly selections = computed<NoteLineSelection[]>(() => {
    const lines = invoiceLines(this.source());
    if (this.scope() === 'total') {
      return lines.map((item) => ({ item, quantity: num(item.quantity) }));
    }
    const state = this.lineState();
    return lines
      .map((item) => {
        const entry = state[item.id];
        return {
          item,
          quantity: entry?.selected ? entry.quantity : 0,
        };
      })
      .filter((selection) => selection.quantity > 0);
  });

  readonly totals = computed(() => noteTotals(this.selections()));

  private readonly hasOverMax = computed(() =>
    this.rows().some((row) => row.overMax),
  );

  readonly canSubmit = computed(() => {
    if (this.submitting() || this.formStatus() !== 'VALID') {
      return false;
    }
    if (this.scope() === 'partial') {
      return this.selections().length > 0 && !this.hasOverMax();
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
    effect(() => {
      const open = this.isOpen();
      const invoice = this.invoice();
      if (!open || !invoice) {
        return;
      }
      const fresh: Record<number, { selected: boolean; quantity: number }> = {};
      for (const item of invoiceLines(invoice)) {
        fresh[item.id] = { selected: false, quantity: num(item.quantity) };
      }
      this.lineState.set(fresh);
    });

    this.actions$
      .pipe(
        ofType(createCreditNoteSuccess, createDebitNoteSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.onSucceeded());

    this.actions$
      .pipe(
        ofType(createCreditNoteFailure, createDebitNoteFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((failure) => this.onFailed(failure));
  }

  money(value: number | string | null | undefined): string {
    return this.currency.format(num(value));
  }

  setNoteType(type: 'credit' | 'debit'): void {
    if (this.submitting() || this.noteType() === type) {
      return;
    }
    this.noteType.set(type);
    // Los catálogos son distintos: arrastrar el código elegido para el otro
    // tipo declararía «Intereses» donde el usuario había elegido «Anulación».
    this.noteForm.controls.conceptCode.setValue('');
    this.clearSubmitError();
  }

  setScope(scope: 'total' | 'partial'): void {
    if (this.submitting()) {
      return;
    }
    this.scope.set(scope);
    this.clearSubmitError();
  }

  toggleLine(item: InvoiceItem, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.lineState.update((state) => ({
      ...state,
      [item.id]: {
        selected: checked,
        quantity: state[item.id]?.quantity ?? num(item.quantity),
      },
    }));
  }

  setQuantity(item: InvoiceItem, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const quantity = Number.isFinite(raw) && raw > 0 ? raw : 0;
    this.lineState.update((state) => ({
      ...state,
      [item.id]: {
        selected: state[item.id]?.selected ?? true,
        quantity,
      },
    }));
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

    this.store.dispatch(
      this.noteType() === 'credit'
        ? createCreditNote({ dto })
        : createDebitNote({ dto }),
    );
  }

  private onSucceeded(): void {
    if (!this.submitting()) {
      return;
    }
    this.submitting.set(false);
    this.clearSubmitError();
    this.reset();
    this.isOpen.set(false);
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
    this.submitError.set(failure.error);
    this.submitErrorDetails.set(extractValidationMessages(failure.details));
  }

  onClose(): void {
    if (this.submitting()) {
      return;
    }
    this.reset();
    this.isOpen.set(false);
  }

  private reset(): void {
    this.noteForm.reset({ conceptCode: '', reason: '' });
    this.scope.set('total');
    this.clearSubmitError();
  }

  private clearSubmitError(): void {
    this.submitError.set(null);
    this.submitErrorDetails.set([]);
  }
}
