import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs';

import { BadgeComponent } from '../../badge/badge.component';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  type SelectorOption,
} from '../../selector/selector.component';
import { ToggleComponent } from '../../toggle/toggle.component';
import { DianResolutionScannerModalComponent } from '../../dian-resolution-scanner/dian-resolution-scanner-modal.component';
import { RESOLUTION_SCAN_FIELD_LABELS } from '../../dian-resolution-scanner/interfaces/resolution-scan-result.interface';
import type {
  DianResolutionScanResult,
  ResolutionScannerScope,
} from '../../dian-resolution-scanner/interfaces/resolution-scan-result.interface';
import { DIAN_API_CONTEXT } from '../../../services/dian';
import { toUTCDateString } from '../../../utils/date.util';
import {
  defaultDocumentTypeFor,
  isFiscalDocumentType,
  requirementsFor,
  resolutionDocumentTypesFor,
  validateResolutionDraft,
  type DianConfigurationType,
  type FiscalDocumentType,
  type FiscalRequirementViolation,
} from '../fiscal-document-requirements';
import type { FiscalReadinessResolution } from '../fiscal-readiness.interface';

/**
 * Lo que el formulario entrega al host. Los nombres son los de
 * `CreateResolutionDto` para que el host no tenga que traducir — una traducción
 * por consola es una oportunidad más de que las dos diverjan.
 */
export interface DianResolutionFormValue {
  document_type: FiscalDocumentType;
  /**
   * Número del acto administrativo. Cadena vacía es LEGÍTIMA en los documentos
   * sin Autorización de Numeración (notas): allí la fila es una fuente de
   * consecutivo interno y este campo un rótulo del comerciante.
   */
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  /**
   * AUSENTE cuando no cambia. En edición, el campo vacío significa «deja la que
   * está», no «bórrala»: el agregado nunca devuelve la ClTec guardada, así que
   * mandar `''` la destruiría sin que nadie lo pidiera.
   */
  technical_key?: string;
}

interface ResolutionFormControls {
  document_type: FormControl<FiscalDocumentType>;
  resolution_number: FormControl<string>;
  resolution_date: FormControl<string>;
  prefix: FormControl<string>;
  range_from: FormControl<number | null>;
  range_to: FormControl<number | null>;
  valid_from: FormControl<string>;
  valid_to: FormControl<string>;
  is_active: FormControl<boolean>;
  technical_key: FormControl<string>;
}

/**
 * Formulario COMPARTIDO de resolución de numeración DIAN.
 *
 * ## Por qué es uno y no dos
 *
 * El panel del comerciante y la consola de superadmin escriben la MISMA fila
 * `invoice_resolutions` contra el MISMO DTO. Con dos formularios, la regla de
 * qué campo aplica a qué documento se escribiría dos veces y sólo una de las dos
 * se corregiría cuando cambie. La que quedara atrás pediría una clave técnica a
 * un documento equivalente POS —que no la usa— o dejaría emitir una factura sin
 * ClTec, y el CUFE resultante lo rechaza la DIAN gastando un consecutivo
 * autorizado que no se recupera.
 *
 * ## Los campos se ADAPTAN, no se deshabilitan
 *
 * Si el documento elegido no admite clave técnica, el campo NO SE RENDERIZA. Un
 * campo deshabilitado sigue afirmando «esto aplica y hoy no puedes tocarlo», que
 * es exactamente la creencia falsa: la nota crédito, el documento soporte y el
 * documento equivalente no firman con ClTec, firman con el Software-PIN. El
 * único que la usa es la factura electrónica de venta.
 *
 * ## La clave técnica guardada no se muestra JAMÁS
 *
 * El agregado sólo informa `technical_key_set: boolean`. En edición el campo va
 * vacío con placeholder «sin cambios» y, si se deja vacío, no viaja en el
 * payload. Rellenarlo con un valor de relleno o con asteriscos invitaría a
 * guardarlo tal cual y a firmar CUFE con una clave inventada.
 *
 * ## Quién persiste
 *
 * El formulario NO llama al backend: emite `save`. Crear y editar cuelgan de
 * flujos distintos en cada consola (NgRx en el panel, servicio directo en la
 * consola), y meterlos aquí ataría el componente a uno de los dos.
 */
@Component({
  selector: 'app-dian-resolution-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    DianResolutionScannerModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!documentTypeOptions().length) {
      <!-- Nómina: el DSPNE numera con su propio consecutivo NumNE. Ofrecer un
           formulario de resolución aquí produciría un 400 ininteligible. -->
      <div class="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
        <app-icon name="info" [size]="14" class="shrink-0 mt-0.5"></app-icon>
        <span>
          La nómina electrónica no lleva resolución de numeración: el documento
          soporte de pago de nómina numera con su propio consecutivo
          <span class="font-mono">NumNE</span>, y la DIAN no emite Autorización
          de Numeración para él.
        </span>
      </div>
    } @else {
      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="submit()">
        <!-- Escáner IA: precarga, nunca guarda por su cuenta -->
        @if (showScanner() && !isEdit()) {
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <p class="text-xs text-[var(--color-text-secondary)]">
              ¿Tienes el PDF de la resolución? Léelo y revisa lo extraído antes
              de guardar.
            </p>
            <app-button
              type="button"
              size="sm"
              variant="outline"
              (clicked)="scannerVisible.set(true)"
            >
              <app-icon slot="icon" name="scan-line" [size]="14"></app-icon>
              Leer resolución
            </app-button>
          </div>
        }

        <!-- Lo que la IA precargó sin poder verificar. Se muestra hasta que el
             usuario guarde: un dígito mal leído en un rango autorizado no falla
             aquí, falla cuando la DIAN rechaza la primera factura. -->
        @if (unverifiedFields().length) {
          <div
            class="rounded-lg border border-warning-300 bg-warning-light px-3 py-2 text-xs text-text-primary"
            role="note"
          >
            <p class="font-semibold mb-1">
              Verifica estos campos precargados por IA
            </p>
            <ul class="list-disc pl-5 space-y-0.5">
              @for (key of unverifiedFields(); track key) {
                <li>{{ scanFieldLabel(key) }}</li>
              }
            </ul>
          </div>
        }

        <!-- Tipo de documento: manda sobre el resto del formulario -->
        <app-selector
          label="Tipo de documento"
          placeholder="Elige el documento que numera esta resolución"
          [required]="true"
          [options]="documentTypeOptions()"
          formControlName="document_type"
        ></app-selector>

        <!-- Qué implica el tipo elegido, dicho antes de pedir los datos -->
        <div
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] text-[var(--color-text-secondary)] flex items-start gap-2"
        >
          <app-icon name="info" [size]="13" class="shrink-0 mt-0.5"></app-icon>
          <span>{{ requirementNote() }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <app-input
            [label]="resolutionNumberLabel()"
            [placeholder]="resolutionNumberPlaceholder()"
            [required]="resolutionNumberRequired()"
            [helperText]="resolutionNumberHelp()"
            formControlName="resolution_number"
          ></app-input>

          <app-input
            type="date"
            label="Fecha de la resolución"
            [required]="true"
            formControlName="resolution_date"
          ></app-input>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <app-input
            label="Prefijo"
            placeholder="Ej: SETP"
            [required]="true"
            formControlName="prefix"
          ></app-input>

          <app-input
            type="number"
            label="Desde"
            [required]="true"
            formControlName="range_from"
          ></app-input>

          <app-input
            type="number"
            label="Hasta"
            [required]="true"
            formControlName="range_to"
          ></app-input>
        </div>

        @if (rangeError(); as message) {
          <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
        }

        @if (currentNumberNote(); as note) {
          <p class="text-[11px] text-[var(--color-text-secondary)] flex items-start gap-1.5">
            <app-icon name="info" [size]="12" class="shrink-0 mt-0.5"></app-icon>
            <span>{{ note }}</span>
          </p>
        }

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <app-input
            type="date"
            label="Vigente desde"
            [required]="true"
            formControlName="valid_from"
          ></app-input>

          <app-input
            type="date"
            label="Vigente hasta"
            [required]="true"
            formControlName="valid_to"
          ></app-input>
        </div>

        @if (validityError(); as message) {
          <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
        }

        <!-- Clave técnica: SÓLO para los documentos que la usan de verdad -->
        @if (acceptsTechnicalKey()) {
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-medium text-[var(--color-text-primary)]">
                Clave técnica (ClTec)
              </span>
              @if (technicalKeyStored()) {
                <app-badge variant="success" badgeStyle="outline" size="xsm">
                  Guardada
                </app-badge>
              }
            </div>
            <app-input
              type="password"
              [placeholder]="technicalKeyPlaceholder()"
              [helperText]="technicalKeyHelp()"
              formControlName="technical_key"
            ></app-input>
          </div>
        }

        <app-toggle
          label="Resolución activa"
          formControlName="is_active"
        ></app-toggle>

        <!-- Violaciones del contrato, antes de enviar nada -->
        @if (contractViolations().length) {
          <div class="flex flex-col gap-1.5">
            @for (violation of contractViolations(); track violation.code) {
              <p
                class="text-xs text-[var(--color-error)] flex items-start gap-1.5"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="13"
                  class="shrink-0 mt-0.5"
                ></app-icon>
                <span>{{ violation.message }}</span>
              </p>
            }
          </div>
        }

        <!-- Error del backend, tal como lo redactó -->
        @if (errorText(); as message) {
          <p class="text-xs text-[var(--color-error)]">{{ message }}</p>
        }

        <div class="flex items-center justify-end gap-2 pt-1">
          <app-button
            type="button"
            size="sm"
            variant="outline"
            (clicked)="cancel.emit()"
          >
            Cancelar
          </app-button>
          <app-button
            type="submit"
            size="sm"
            variant="primary"
            [disabled]="!canSave()"
            [loading]="saving()"
          >
            <app-icon slot="icon" name="save" [size]="14"></app-icon>
            {{ isEdit() ? 'Guardar cambios' : 'Crear resolución' }}
          </app-button>
        </div>
      </form>

      @if (scannerVisible()) {
        <app-dian-resolution-scanner-modal
          [isOpen]="true"
          [scope]="scannerScope()"
          (isOpenChange)="scannerVisible.set($event)"
          (confirmed)="applyScan($event)"
        ></app-dian-resolution-scanner-modal>
      }
    }
  `,
})
export class DianResolutionFormComponent {
  /** Habilitación a la que pertenece la resolución. Acota los tipos ofrecidos. */
  readonly configurationType = input.required<DianConfigurationType>();

  /**
   * Resolución existente: activa el modo edición. `null` = alta.
   *
   * OJO con `resolution_number`: el agregado de readiness no lo devuelve (sólo
   * identifica la fila por rango y documento). Si el host lo tiene —`GET
   * {rail}/resolutions` sí lo trae—, debe pasarlo enriquecido; si no, el campo
   * arranca vacío y para una factura de venta habrá que reescribirlo, porque el
   * contrato lo exige y este formulario no puede inventarlo.
   */
  readonly resolution = input<FiscalReadinessResolution | null>(null);

  /** Preselección del tipo de documento en alta. Debe pertenecer a la habilitación. */
  readonly documentType = input<FiscalDocumentType | null>(null);

  /** El host está persistiendo. Bloquea el envío, no la edición del formulario. */
  readonly saving = input(false);

  /** Error devuelto por el backend, ya redactado. Se muestra crudo. */
  readonly errorText = input<string | null>(null);

  /** Namespace al que sube el archivo el escáner IA. */
  readonly scannerScope = input<ResolutionScannerScope>('store');

  /** Permite apagar el escáner en hosts donde no aplica. */
  readonly showScanner = input(true);

  /** Payload validado contra el contrato. El host decide POST o PATCH. */
  readonly save = output<DianResolutionFormValue>();
  readonly cancel = output<void>();

  private readonly dianContext = inject(DIAN_API_CONTEXT);
  readonly capabilities = computed(() => this.dianContext.capabilities());

  readonly scannerVisible = signal(false);

  /**
   * Campos que el escáner IA precargó pero NO pudo verificar (o leyó con baja
   * confianza). Se listan porque una resolución autoriza numeración legal: un
   * dígito mal leído no se descubre en este formulario sino cuando la DIAN
   * rechaza la primera factura, con el consecutivo ya gastado.
   */
  readonly unverifiedFields = signal<readonly string[]>([]);

  readonly form = new FormGroup<ResolutionFormControls>({
    document_type: new FormControl<FiscalDocumentType>('sales_invoice', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    resolution_number: new FormControl('', { nonNullable: true }),
    resolution_date: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    prefix: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(10)],
    }),
    range_from: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    range_to: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    valid_from: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    valid_to: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    is_active: new FormControl(true, { nonNullable: true }),
    technical_key: new FormControl('', { nonNullable: true }),
  });

  /**
   * Puentes de estado del formulario a señales.
   *
   * `form.value` y `form.status` son PROPIEDADES, no señales. Leerlas dentro de
   * un `computed` lo evalúa una vez con el estado inicial —inválido, por los
   * `Validators.required`— y no vuelve a recalcular: el botón «Guardar» se
   * quedaría deshabilitado para siempre por mucho que el usuario rellenara el
   * formulario. Es el fallo silencioso más caro de este repo y por eso el puente
   * es explícito.
   */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  /**
   * Puente SÓLO del tipo de documento, separado de `formValue` a propósito.
   *
   * El efecto que recalcula validators depende de esto; si dependiera del valor
   * completo del formulario se dispararía en cada pulsación de tecla y, al
   * escribir de vuelta en el formulario, se realimentaría a sí mismo. Aquí sólo
   * corre cuando cambia de verdad lo único que gobierna la forma del formulario.
   */
  private readonly documentTypeValue = toSignal(
    this.form.controls.document_type.valueChanges.pipe(
      startWith(this.form.controls.document_type.value),
    ),
    { initialValue: this.form.controls.document_type.value },
  );

  readonly isEdit = computed(() => this.resolution() !== null);

  /** ¿La resolución que se edita ya tiene ClTec guardada? El valor no viaja nunca. */
  readonly technicalKeyStored = computed(
    () => this.resolution()?.technical_key_set === true,
  );

  readonly documentTypeOptions = computed<SelectorOption[]>(() =>
    resolutionDocumentTypesFor(this.configurationType()).map((type) => {
      const requirements = requirementsFor(type);
      return {
        value: type,
        label: requirements.label,
        description: requirements.requires_authorized_range
          ? `Numeración autorizada por la DIAN · clave ${requirements.key_algorithm}`
          : `Consecutivo interno · clave ${requirements.key_algorithm}`,
      };
    }),
  );

  /** Tipo actualmente elegido, leído del puente y NO de `form.value`. */
  readonly selectedDocumentType = computed<FiscalDocumentType>(() => {
    const raw = this.documentTypeValue();
    if (isFiscalDocumentType(raw)) return raw;
    return defaultDocumentTypeFor(this.configurationType());
  });

  readonly requirements = computed(() =>
    requirementsFor(this.selectedDocumentType()),
  );

  readonly acceptsTechnicalKey = computed(
    () => this.requirements().accepts_technical_key,
  );

  readonly resolutionNumberRequired = computed(
    () => this.requirements().requires_authorized_range,
  );

  readonly resolutionNumberLabel = computed(() =>
    this.resolutionNumberRequired()
      ? 'Número de resolución DIAN'
      : 'Identificador de la numeración',
  );

  readonly resolutionNumberPlaceholder = computed(() =>
    this.resolutionNumberRequired()
      ? 'Ej: 18760000001234'
      : 'Rótulo interno (opcional)',
  );

  readonly resolutionNumberHelp = computed(() =>
    this.resolutionNumberRequired()
      ? 'Es el valor de sts:InvoiceAuthorization que la DIAN confronta contra la autorización del punto de facturación.'
      : 'La DIAN no emite Autorización de Numeración para este documento. Este campo es un rótulo tuyo, no un acto administrativo.',
  );

  readonly technicalKeyPlaceholder = computed(() =>
    this.technicalKeyStored()
      ? 'Sin cambios'
      : 'ClTec entregada por la DIAN con el rango',
  );

  readonly technicalKeyHelp = computed(() =>
    this.technicalKeyStored()
      ? 'Hay una clave técnica guardada. Se muestra vacía a propósito: el servidor nunca la devuelve. Déjala vacía para conservarla.'
      : `Alimenta el ${this.requirements().key_algorithm} de cada documento. Firmar con el Software-PIN en su lugar produce una clave que la DIAN rechaza.`,
  );

  readonly requirementNote = computed(() => {
    const requirements = this.requirements();
    const range = requirements.requires_authorized_range
      ? 'Cuelga de una Autorización de Numeración de la DIAN: el rango y su número son un acto administrativo.'
      : 'La DIAN no autoriza numeración para este documento; la fila existe como fuente de consecutivo interno.';
    const key = requirements.accepts_technical_key
      ? `Su ${requirements.key_algorithm} se arma con la clave técnica (ClTec) del rango.`
      : `Su ${requirements.key_algorithm} lleva el Software-PIN como 14º campo, no una clave técnica.`;
    return `${requirements.label}. ${range} ${key}`;
  });

  readonly rangeError = computed<string | null>(() => {
    const value = this.formValue();
    const from = Number(value.range_from);
    const to = Number(value.range_to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (to <= from) {
      return 'El número final del rango tiene que ser mayor que el inicial.';
    }
    return null;
  });

  readonly validityError = computed<string | null>(() => {
    const value = this.formValue();
    if (!value.valid_from || !value.valid_to) return null;
    if (value.valid_to < value.valid_from) {
      return 'La vigencia no puede terminar antes de empezar.';
    }
    return null;
  });

  /**
   * Aviso —no bloqueo— cuando el rango nuevo deja fuera el consecutivo por el
   * que ya va la resolución. Bloquearlo sería impedir corregir una fila mal
   * creada; callarlo dejaría al comerciante emitiendo fuera del rango
   * autorizado.
   */
  readonly currentNumberNote = computed<string | null>(() => {
    const existing = this.resolution();
    if (!existing) return null;
    const value = this.formValue();
    const from = Number(value.range_from);
    const to = Number(value.range_to);

    // Mismo predicado que el backend (`invoice-resolutions.service.ts`): el
    // consecutivo nace en `range_from - 1`, así que una fila intacta está por
    // debajo de su propio piso POR CONSTRUCCIÓN. Sin este corte, toda
    // resolución recién creada abre su formulario acusada de emitir fuera del
    // rango autorizado —y un aviso que grita en falso es un aviso que el
    // comerciante deja de leer justo cuando pasa a ser cierto.
    if (existing.current_number < existing.range_from) {
      return Number.isFinite(from)
        ? `Esta resolución todavía no ha emitido: el próximo documento saldrá con el ${from}.`
        : 'Esta resolución todavía no ha emitido.';
    }

    const base = `Esta resolución va por el consecutivo ${existing.current_number}.`;
    if (
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      (existing.current_number < from || existing.current_number > to)
    ) {
      return `${base} El rango que estás guardando lo deja fuera: los documentos siguientes saldrían con una numeración que la DIAN no autorizó.`;
    }
    return base;
  });

  /** Violaciones del contrato, evaluadas con el MISMO predicado que el backend. */
  readonly contractViolations = computed<FiscalRequirementViolation[]>(() => {
    const value = this.formValue();
    return validateResolutionDraft({
      document_type: this.selectedDocumentType(),
      resolution_number: value.resolution_number ?? '',
      technical_key: this.acceptsTechnicalKey() ? (value.technical_key ?? '') : '',
      technical_key_already_stored: this.technicalKeyStored(),
    });
  });

  readonly canSave = computed(
    () =>
      this.formStatus() === 'VALID' &&
      !this.contractViolations().length &&
      !this.rangeError() &&
      !this.validityError() &&
      !this.saving() &&
      this.capabilities().writeConfig,
  );

  /**
   * Última siembra aplicada. Campo plano a propósito: no lo lee ninguna
   * plantilla, así que convertirlo en señal sólo añadiría ruido reactivo.
   */
  private lastSeedKey: string | null = null;

  constructor() {
    // El tipo de documento gobierna qué se exige. Los validators se recalculan
    // AQUÍ y no en el template: un campo que se deja de renderizar pero conserva
    // su `Validators.required` deja el formulario inválido sin nada que señalar.
    effect(() => {
      const requirements = this.requirements();
      const control = this.form.controls.resolution_number;
      const shouldRequire = requirements.requires_authorized_range;
      const hasRequired = control.hasValidator(Validators.required);

      if (shouldRequire && !hasRequired) {
        control.addValidators(Validators.required);
        control.updateValueAndValidity({ emitEvent: true });
      } else if (!shouldRequire && hasRequired) {
        control.removeValidators(Validators.required);
        control.updateValueAndValidity({ emitEvent: true });
      }

      // Una ClTec tecleada para un documento que no la usa no puede quedarse
      // esperando en el payload: sugeriría que se firmará con ella.
      if (!requirements.accepts_technical_key) {
        const technicalKey = this.form.controls.technical_key;
        if (technicalKey.value) technicalKey.setValue('', { emitEvent: true });
      }
    });

    // Sin permiso de escritura el formulario se ve, pero no se toca. Se
    // deshabilita el FormGroup entero en vez de esconderlo: en la consola de
    // superadmin, un operador con sólo lectura necesita poder LEER la
    // configuración del tenant al que está atendiendo por teléfono.
    effect(() => {
      const canWrite = this.capabilities().writeConfig;
      if (canWrite && this.form.disabled) this.form.enable({ emitEvent: true });
      if (!canWrite && this.form.enabled) this.form.disable({ emitEvent: true });
    });

    // Siembra del formulario. Depende de inputs, así que no puede vivir en el
    // inicializador del FormGroup: `configurationType()` todavía no existe ahí.
    effect(() => {
      const configurationType = this.configurationType();
      const existing = this.resolution();
      const preferred = this.documentType();
      const allowed = resolutionDocumentTypesFor(configurationType);
      if (!allowed.length) return;

      // Sembrar UNA vez por resolución. Un host que recree el objeto en cada
      // ciclo —cosa habitual al recargar el agregado— borraría lo que el usuario
      // está escribiendo si esto volviera a sembrar por identidad de objeto.
      const seedKey = `${configurationType}:${existing?.id ?? 'new'}:${preferred ?? ''}`;
      if (seedKey === this.lastSeedKey) return;
      this.lastSeedKey = seedKey;

      if (existing) {
        this.form.reset({
          document_type: allowed.includes(existing.document_type)
            ? existing.document_type
            : allowed[0],
          resolution_number: existing.resolution_number ?? '',
          resolution_date: existing.resolution_date
            ? toUTCDateString(new Date(existing.resolution_date))
            : '',
          prefix: existing.prefix ?? '',
          range_from: existing.range_from,
          range_to: existing.range_to,
          valid_from: toUTCDateString(new Date(existing.valid_from)),
          valid_to: toUTCDateString(new Date(existing.valid_to)),
          is_active: existing.is_active,
          // Vacía SIEMPRE. `technical_key_set` dice que existe; el valor no
          // viaja del backend y no hay nada honesto que poner aquí.
          technical_key: '',
        });
        return;
      }

      const initial =
        preferred && allowed.includes(preferred)
          ? preferred
          : (allowed.find(
              (type) => type === defaultDocumentTypeFor(configurationType),
            ) ?? allowed[0]);
      this.form.controls.document_type.setValue(initial);
    });
  }

  /**
   * Precarga desde el escáner IA. Sólo se copian los campos que el escáner
   * marcó con valor: sobrescribir con `null` lo ya tecleado a mano castigaría
   * al usuario por pedir ayuda.
   *
   * El `document_type` se acepta únicamente si pertenece a esta habilitación: el
   * escáner sólo distingue factura de venta y documento soporte, y dejarlo
   * cambiar el eje movería la resolución a una habilitación que no es la suya.
   */
  applyScan(scan: DianResolutionScanResult): void {
    const allowed = resolutionDocumentTypesFor(this.configurationType());
    const scanned = scan.document_type?.value ?? null;
    if (scanned && isFiscalDocumentType(scanned) && allowed.includes(scanned)) {
      this.form.controls.document_type.setValue(scanned);
    }

    if (scan.resolution_number?.value) {
      this.form.controls.resolution_number.setValue(scan.resolution_number.value);
    }
    if (scan.resolution_date?.value) {
      this.form.controls.resolution_date.setValue(scan.resolution_date.value);
    }
    if (scan.prefix?.value) {
      this.form.controls.prefix.setValue(scan.prefix.value);
    }
    if (scan.range_from?.value !== null && scan.range_from?.value !== undefined) {
      this.form.controls.range_from.setValue(scan.range_from.value);
    }
    if (scan.range_to?.value !== null && scan.range_to?.value !== undefined) {
      this.form.controls.range_to.setValue(scan.range_to.value);
    }
    if (scan.valid_from?.value) {
      this.form.controls.valid_from.setValue(scan.valid_from.value);
    }
    if (scan.valid_to?.value) {
      this.form.controls.valid_to.setValue(scan.valid_to.value);
    }
    // La ClTec extraída sólo se copia si el documento la usa. Para los demás, el
    // campo ni siquiera está en pantalla.
    if (scan.technical_key?.value && this.acceptsTechnicalKey()) {
      this.form.controls.technical_key.setValue(scan.technical_key.value);
    }

    // Lo que la IA precargó pero NO pudo verificar. Se arrastra hasta que el
    // usuario guarde: una resolución autoriza numeración legal, y un dígito mal
    // leído no se descubre aquí sino cuando la DIAN rechaza la primera factura
    // —con el consecutivo ya gastado—. Sólo se listan los campos que este
    // documento realmente usa: señalar la clave técnica de un documento soporte,
    // donde el campo ni se renderiza, mandaría a verificar algo inexistente.
    const shown = new Set(Object.keys(this.form.controls));
    this.unverifiedFields.set(
      (scan.requires_manual_confirmation ?? []).filter(
        (key) =>
          shown.has(key) &&
          (key !== 'technical_key' || this.acceptsTechnicalKey()),
      ),
    );

    this.scannerVisible.set(false);
  }

  /** Rótulo legible de un campo señalado por el escáner. */
  scanFieldLabel(key: string): string {
    return (
      (RESOLUTION_SCAN_FIELD_LABELS as Record<string, string>)[key] ?? key
    );
  }

  submit(): void {
    if (!this.canSave()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const documentType = this.selectedDocumentType();
    const technicalKey = raw.technical_key.trim();

    const payload: DianResolutionFormValue = {
      document_type: documentType,
      resolution_number: raw.resolution_number.trim(),
      resolution_date: raw.resolution_date,
      prefix: raw.prefix.trim(),
      range_from: Number(raw.range_from),
      range_to: Number(raw.range_to),
      valid_from: raw.valid_from,
      valid_to: raw.valid_to,
      is_active: raw.is_active,
    };

    // Sólo viaja cuando el documento la admite Y el usuario escribió algo. En
    // edición con el campo vacío se omite: el backend conserva la guardada.
    if (this.acceptsTechnicalKey() && technicalKey) {
      payload.technical_key = technicalKey;
    }

    this.save.emit(payload);
  }
}
