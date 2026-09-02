import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { AlertBannerComponent } from '../alert-banner/alert-banner.component';
import type { AlertBannerVariant } from '../alert-banner/alert-banner.component';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import { SelectorComponent } from '../selector/selector.component';
import type {
  SelectorOption,
  SelectorSize,
} from '../selector/selector.component';
import { TextareaComponent } from '../textarea/textarea.component';
import { CONFIG_LIMITS } from '../../../core/utils/invoice-profile-config.contract';
import { remainingChars, showCharCounter } from '../../../private/modules/store/invoicing/utils/char-limit.util';
import { InvoiceResolutionBannerComponent } from '../../../private/modules/store/invoicing/components/invoice-create/invoice-resolution-banner.component';
import type { InvoiceResolution } from '../../../private/modules/store/invoicing/interfaces/invoice.interface';
import type { InvoiceSectionContext } from './invoice-section-context';
import { optionalControl, requireControl } from './invoice-section-controls';
import { isInvoiceContext, isProfileContext } from './invoice-section-context';

const SECTION = 'documento';

/**
 * Dónde vive cada control de la sección Documento en el formulario de la
 * pantalla que la aloja.
 *
 * `notes` y `header_notes` son mutuamente excluyentes según `context`: la
 * factura guarda UNA nota de cabecera en un `FormControl` de texto —el DTO
 * declara `notes?: string`—, y el perfil guarda una LISTA en un `FormArray`
 * —el snapshot de configuración es un documento completo y puede precargar
 * más de una—. No es una diferencia de nombre, es una diferencia de FORMA de
 * control, así que el componente pinta un editor u otro según el contexto en
 * vez de forzar el mismo control a las dos pantallas (ver el field-map:
 * `toInvoicePayload` ya une con `\n` para el lado factura). `issue_date` y
 * `due_date` son `null` en el perfil a propósito: un perfil no tiene fecha de
 * emisión propia.
 */
export interface DocumentoSectionPaths {
  invoice_type: string;
  payment_form: string;
  payment_means_code: string;
  /** Sólo existe en contexto `invoice`. */
  issue_date: string | null;
  /** Sólo existe en contexto `invoice`. */
  due_date: string | null;
  /** Sólo existe en contexto `invoice`: control de texto único. */
  notes: string | null;
  /** Sólo existe en contexto `profile`: `FormArray` de notas de cabecera. */
  header_notes: string | null;
}

/** Un aviso ya resuelto por la página, listo para pintarse como banner. */
export interface DocumentoSectionNotice {
  variant: AlertBannerVariant;
  text: string;
  icon?: string;
}

/** Mensajes de error por campo, ya resueltos por la página. */
export interface DocumentoSectionErrors {
  resolution?: string;
  invoice_type?: string;
  issue_date?: string;
  payment_form?: string;
  payment_means_code?: string;
  due_date?: string;
  notes?: string;
}

/**
 * Sección «Documento»: tipo de documento, resolución, forma y medio de pago,
 * fechas y notas de cabecera. B.2 del plan CP-INVOICE-PROFILE-MIRROR-AIU.
 *
 * ## Lo que la página sigue decidiendo
 *
 * `operation_type` NO vive acá aunque en «Nueva factura» hoy comparte tarjeta
 * visual con este grupo: en el editor de perfiles el tipo de operación está
 * FUERA de «Documento» (decide qué secciones aplican, no es un dato del
 * documento en sí), así que meterlo en el componente compartido inventaría
 * un campo que el perfil no tiene. La página sigue pintando su propio
 * selector de tipo de operación junto a este componente.
 *
 * La lógica de CUÁNDO aparece cada aviso de resolución (perfil que no se pudo
 * honrar, rango vencido, numeración de habilitación, clave técnica dudosa)
 * sigue siendo de la página: depende de señales que sólo la factura tiene
 * (perfil activo, catálogo de resoluciones, estado DIAN). Lo que este
 * componente centraliza es el MARCADO del aviso — un `app-alert-banner` por
 * entrada de `notices` — no la decisión de negocio de mostrarlo.
 */
@Component({
  selector: 'vendix-invoice-section-documento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [
    ReactiveFormsModule,
    AlertBannerComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    InvoiceResolutionBannerComponent,
  ],
  template: `
    <div class="space-y-4">
      <!--
        RESOLUCIÓN. Va primero: es el dato que gasta numeración autorizada
        (factura) o la preferencia que la precarga (perfil), y las dos
        pantallas ya lo ponían delante de todo lo demás.
      -->
      <div
        class="rounded-lg border border-border p-3 space-y-2"
        [style.background]="isInvoice() ? 'var(--color-background)' : null"
      >
        <app-selector
          label="Resolución de numeración"
          [formControl]="resolutionControl()"
          [options]="resolutionOptions()"
          [placeholder]="resolutionPlaceholder()"
          [helpText]="resolutionHelpText()"
          [errorText]="errors().resolution ?? ''"
          [disabled]="resolutionOptions().length === 0"
          [size]="resolutionSize()"
        ></app-selector>

        @if (resolutionHint(); as hint) {
          <!-- Sólo el perfil pinta esto: la factura ya lo dice como banner
               de peligro dentro de «notices» (ver «resolutionEmptyReason»
               en la página). -->
          <p class="text-xs text-text-secondary">{{ hint }}</p>
        }

        @for (notice of notices(); track $index) {
          <app-alert-banner
            [variant]="notice.variant"
            [icon]="notice.icon ?? 'alert-triangle'"
            tone="token"
          >
            {{ notice.text }}
          </app-alert-banner>
        }

        @if (isInvoice()) {
          <vendix-invoice-resolution-banner
            [resolution]="activeResolution()"
            [loading]="activeResolutionLoading()"
            [documentLabel]="documentLabel()"
          />
        }
      </div>

      <div
        class="grid grid-cols-1 gap-3"
        [class.md:grid-cols-2]="isInvoice()"
      >
        <app-selector
          label="Tipo de documento"
          [formControl]="invoiceTypeControl()"
          [options]="invoiceTypeOptions()"
          [errorText]="errors().invoice_type ?? ''"
          size="sm"
          (valueChange)="invoiceTypeChanged.emit()"
        ></app-selector>

        @if (isInvoice()) {
          <app-input
            label="Fecha de emisión"
            type="date"
            [formControl]="issueDateControl()!"
            [error]="errors().issue_date"
            [required]="true"
            size="sm"
            (inputChange)="issueDateChanged.emit()"
          ></app-input>
        }
      </div>

      <div
        class="grid grid-cols-1 gap-3"
        [class.md:grid-cols-3]="isInvoice()"
        [class.md:grid-cols-2]="isProfile()"
      >
        <app-selector
          label="Forma de pago"
          [formControl]="paymentFormControl()"
          [options]="paymentFormOptions()"
          [errorText]="errors().payment_form ?? ''"
          size="sm"
          (valueChange)="paymentFormChanged.emit()"
        ></app-selector>
        <app-selector
          label="Medio de pago"
          [formControl]="paymentMeansCodeControl()"
          [options]="paymentMeansOptions()"
          [errorText]="errors().payment_means_code ?? ''"
          size="sm"
        ></app-selector>

        @if (isInvoice()) {
          <app-input
            label="Vencimiento"
            type="date"
            [formControl]="dueDateControl()!"
            [error]="errors().due_date"
            [required]="dueDateRequired()"
            [helperText]="dueDateHelp()"
            size="sm"
          ></app-input>
        }
      </div>

      @if (isInvoice()) {
        <div>
          <app-textarea
            label="Notas"
            [formControl]="notesControl()!"
            [error]="errors().notes"
            placeholder="Observaciones que se imprimen en el documento..."
            [rows]="2"
          ></app-textarea>
          <!--
            «app-textarea» (shared/components/textarea) no reenvía
            «maxlength» al «textarea» nativo —a diferencia de «app-input»—,
            así que este contador es hoy la única defensa en pantalla: el
            tope real (500, FAD13) lo hace cumplir «Validators.maxLength» en
            la página, no el navegador cortando el tecleo.
          -->
          @if (showCharCounter(notesControl()!.value, headerNoteLimit())) {
            <p
              class="text-[10px] text-right leading-tight"
              [class.text-destructive]="
                remainingChars(notesControl()!.value, headerNoteLimit()) <= 0
              "
              [class.text-text-secondary]="
                remainingChars(notesControl()!.value, headerNoteLimit()) > 0
              "
            >
              {{ remainingChars(notesControl()!.value, headerNoteLimit()) }}
              caracteres restantes
            </p>
          }
        </div>
      } @else {
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-text-secondary">
              Notas de cabecera. Se precargan en la factura y viajan como
              <code>cbc:Note</code> del documento.
            </p>
            <app-button variant="secondary" size="sm" (clicked)="addHeaderNote()">
              <app-icon slot="icon" name="plus" [size]="14"></app-icon>
              Nota
            </app-button>
          </div>
          @if (headerNotesArray()!.controls.length === 0) {
            <p class="text-xs text-text-secondary italic">
              Sin notas. La factura no llevará ninguna precargada.
            </p>
          }
          <div class="space-y-2">
            @for (note of headerNotesArray()!.controls; track $index) {
              <div class="flex items-end gap-2">
                <div class="flex-1">
                  <app-input
                    [label]="'Nota ' + ($index + 1)"
                    [formControl]="asFormControl(note)"
                    [maxlength]="headerNoteLimit()"
                    size="sm"
                    [error]="headerNoteErrors()[$index]"
                  ></app-input>
                  @if (showCharCounter(asFormControl(note).value, headerNoteLimit())) {
                    <p
                      class="text-[10px] text-right leading-tight"
                      [class.text-destructive]="
                        remainingChars(asFormControl(note).value, headerNoteLimit()) <= 0
                      "
                      [class.text-text-secondary]="
                        remainingChars(asFormControl(note).value, headerNoteLimit()) > 0
                      "
                    >
                      {{ remainingChars(asFormControl(note).value, headerNoteLimit()) }}
                      caracteres restantes
                    </p>
                  }
                </div>
                <app-button
                  variant="outline-danger"
                  size="sm"
                  ariaLabel="Quitar esta nota de cabecera"
                  (clicked)="removeHeaderNote($index)"
                >
                  <app-icon slot="icon" name="trash-2" [size]="15"></app-icon>
                </app-button>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class InvoiceSectionDocumentoComponent {
  readonly context = input.required<InvoiceSectionContext>();
  readonly form = input.required<FormGroup>();
  readonly paths = input.required<DocumentoSectionPaths>();

  readonly invoiceTypeOptions = input.required<SelectorOption[]>();
  readonly paymentFormOptions = input.required<SelectorOption[]>();
  readonly paymentMeansOptions = input.required<SelectorOption[]>();

  /** El propio `FormControl` de resolución: las dos páginas ya lo exponen
   * como un getter (`resolutionControl`) porque `resolution_id` tiene un
   * único escritor programático y el enlace directo deja ese hecho a la
   * vista — ver el comentario original en la factura. No pasa por `paths`
   * porque no es una ruta dentro del `FormGroup` de la sección: vive en la
   * raíz de cada formulario con nombre distinto en cada uno. */
  readonly resolutionControl = input.required<FormControl<number | null>>();
  readonly resolutionOptions = input.required<SelectorOption[]>();
  readonly resolutionPlaceholder = input.required<string>();
  readonly resolutionHelpText = input<string>('');
  /**
   * `md` en la factura, a propósito: «es el campo que gasta numeración
   * autorizada, y cada número que se toma de un rango se consume aunque la
   * DIAN rechace el documento» (comentario original de la pantalla). `sm`
   * en el perfil, que sólo preconfigura una preferencia.
   */
  readonly resolutionSize = input<SelectorSize>('sm');
  /** Texto plano (no banner) para el estado vacío. Sólo lo usa el perfil. */
  readonly resolutionHint = input<string | null>(null);
  /** Avisos ya resueltos por la página, en el orden en que deben pintarse. */
  readonly notices = input<readonly DocumentoSectionNotice[]>([]);
  /** Sólo contexto `invoice`: la resolución realmente activa hoy. */
  readonly activeResolution = input<InvoiceResolution | null>(null);
  /**
   * Si el catálogo de resoluciones TODAVÍA se está trayendo.
   *
   * Sin esto, mientras la lista viaja `activeResolution` es `null` y el banner
   * pinta «No hay resolución activa» —el mismo rojo que significa «esto no se
   * va a poder emitir»— para acabar corrigiéndose solo medio segundo después.
   * El banner ya sabe pintar «Buscando la resolución activa…»; sólo le faltaba
   * que alguien se lo dijera.
   *
   * `false` por defecto: la página que no lo pase se comporta exactamente como
   * hasta ahora.
   */
  readonly activeResolutionLoading = input<boolean>(false);
  readonly documentLabel = input<string>('Factura de venta');

  readonly errors = input<DocumentoSectionErrors>({});
  readonly dueDateRequired = input<boolean>(false);
  readonly dueDateHelp = input<string>('');
  /** Un mensaje por índice de nota de cabecera. Sólo aplica en el perfil. */
  readonly headerNoteErrors = input<readonly (string | undefined)[]>([]);
  readonly headerNoteLimit = input<number>(CONFIG_LIMITS.header_note);

  readonly invoiceTypeChanged = output<void>();
  readonly paymentFormChanged = output<void>();
  /** Emitido cuando cambia la fecha de emisión, para resincronizar el
   * vencimiento — la página sigue siendo dueña de esa regla
   * (`syncDueDate()`). Sólo se dispara en contexto `invoice`. */
  readonly issueDateChanged = output<void>();

  readonly isInvoice = computed(() => isInvoiceContext(this.context()));
  readonly isProfile = computed(() => isProfileContext(this.context()));

  /** F.3: contador de caracteres, expuesto para la plantilla. */
  readonly remainingChars = remainingChars;
  readonly showCharCounter = showCharCounter;

  readonly invoiceTypeControl = computed<FormControl>(
    () => requireControl(this.form(), this.paths().invoice_type, SECTION) as FormControl,
  );

  readonly paymentFormControl = computed<FormControl>(
    () => requireControl(this.form(), this.paths().payment_form, SECTION) as FormControl,
  );

  readonly paymentMeansCodeControl = computed<FormControl>(
    () =>
      requireControl(this.form(), this.paths().payment_means_code, SECTION) as FormControl,
  );

  readonly issueDateControl = computed<FormControl | null>(
    () => optionalControl(this.form(), this.paths().issue_date) as FormControl | null,
  );

  readonly dueDateControl = computed<FormControl | null>(
    () => optionalControl(this.form(), this.paths().due_date) as FormControl | null,
  );

  readonly notesControl = computed<FormControl | null>(
    () => optionalControl(this.form(), this.paths().notes) as FormControl | null,
  );

  readonly headerNotesArray = computed<FormArray | null>(() => {
    const path = this.paths().header_notes;
    if (!path) return null;
    return optionalControl(this.form(), path) as FormArray | null;
  });

  /** `app-input` exige un `FormControl`; los elementos de un `FormArray`
   * llegan tipados como `AbstractControl` desde `.controls`. */
  asFormControl(control: unknown): FormControl {
    return control as FormControl;
  }

  addHeaderNote(): void {
    // F.3: la misma cota (FAD13, 500) que ya declara `headerNoteLimit()` como
    // `maxlength` nativo del `app-input` — el validador es lo que además hace
    // inválido el formulario si algo la sobrepasa (pegado, no sólo tecleado).
    this.headerNotesArray()?.push(
      new FormControl('', Validators.maxLength(this.headerNoteLimit())),
    );
  }

  removeHeaderNote(index: number): void {
    this.headerNotesArray()?.removeAt(index);
  }
}
