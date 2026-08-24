import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { IconComponent } from '../../icon/icon.component';
import { FileUploadDropzoneComponent } from '../../file-upload-dropzone/file-upload-dropzone.component';
import { formatDateOnlyUTC } from '../../../utils/date.util';
// Validadores compartidos por las cuatro puertas de entrada de configuración DIAN.
import {
  DIAN_VALIDATION_MESSAGES,
  dianSoftwarePinValidator,
  dianUuidValidator,
  nitFormatValidator,
  rangeOrderValidator,
} from '../../../utils/dian-validators';
import { nitDvValidator } from '../../../utils/nit.util';

export type DianEnvironment = 'test' | 'production';

/** Fields that together make a persistable numbering resolution. */
const RESOLUTION_REQUIRED_FIELDS = [
  'resolution_number',
  'resolution_prefix',
  'resolution_range_from',
  'resolution_range_to',
  'resolution_valid_from',
  'resolution_valid_to',
  'resolution_date',
] as const;

/** Human labels for the group-level "resolución incompleta" message. */
const RESOLUTION_FIELD_LABELS: Record<string, string> = {
  resolution_number: 'número de resolución',
  resolution_prefix: 'prefijo',
  resolution_range_from: 'rango desde',
  resolution_range_to: 'rango hasta',
  resolution_valid_from: 'vigente desde',
  resolution_valid_to: 'vigente hasta',
  resolution_date: 'fecha de la resolución',
};

/**
 * Etiqueta de cada control, LA MISMA que pinta su `<app-input>`/`<app-selector>`.
 *
 * Se repite acá a propósito en vez de leerse del template: el usuario recorre la
 * pantalla buscando el rótulo que le nombra el bloque de faltantes, y un texto
 * que no coincida con el que ve lo manda a buscar un campo que no existe. Si un
 * `label` del template cambia, cambia también acá.
 */
const CONTROL_LABELS: Record<string, string> = {
  name: 'Nombre de la configuración',
  nit_type: 'Tipo documento',
  nit: 'NIT',
  nit_dv: 'DV',
  environment: 'Ambiente',
  software_id: 'Software ID',
  software_pin: 'Software PIN',
  test_set_id: 'Test Set ID',
  resolution_number: 'Número de resolución',
  resolution_prefix: 'Prefijo',
  resolution_range_from: 'Rango desde',
  resolution_range_to: 'Rango hasta',
  resolution_valid_from: 'Vigente desde',
  resolution_valid_to: 'Vigente hasta',
  resolution_date: 'Fecha de la resolución',
  resolution_technical_key: 'Clave técnica (ClTec)',
  certificate_password: 'Contraseña del certificado',
};

/**
 * Motivo legible de por qué un control es inválido.
 *
 * `required` lleva texto propio en vez del de `DIAN_VALIDATION_MESSAGES` («Este
 * dato es obligatorio.»): ese está redactado como frase suelta bajo el campo, y
 * acá el motivo va pegado a la etiqueta dentro de una lista de faltantes. El
 * resto sí sale del diccionario compartido, que es lo que hace que las cuatro
 * puertas de entrada a la configuración DIAN digan LO MISMO del mismo rechazo.
 */
function describeControlErrors(errors: ValidationErrors): string {
  if (errors['required']) return 'falta completarlo';
  for (const key of Object.keys(errors)) {
    const message = DIAN_VALIDATION_MESSAGES[key];
    if (message) return message;
  }
  return 'revisa el dato ingresado';
}

/**
 * Anchuras que la DIAN sí emite para la clave técnica (ClTec).
 *
 * NO es una sola: la ClTec es la representación hexadecimal de un hash y la DIAN
 * usa DOS familias — SHA-1 (40 caracteres) y SHA-256 (64). Dar por sentado el 40
 * ya costó un incidente: con HIDRO (NIT 902075738, caso FAD06) este invariante
 * rechazó como «malformada» una clave legítima de 64 y la resolución se cayó con
 * `INVOICING_RESOLUTION_011`.
 *
 * La lista se queda CERRADA en esas dos. Abrirla a «cualquier longitud» tiraría
 * el valor del aviso: el mismo contribuyente reportó claves de 36, 38 y 39
 * caracteres, y un hash no tiene longitud variable — eran la misma clave con
 * caracteres perdidos al copiarla de un PDF. Detectar justamente eso es para lo
 * que existe la advertencia.
 */
const TECHNICAL_KEY_VALID_LENGTHS: readonly number[] = [40, 64];

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/** True when at least one resolution field carries a value. */
function hasAnyResolutionValue(raw: Record<string, unknown>): boolean {
  return RESOLUTION_REQUIRED_FIELDS.some((field) => isFilled(raw[field]));
}

/** True when EVERY resolution field carries a value — es decir, persistible. */
function hasAllResolutionValues(raw: Record<string, unknown>): boolean {
  return RESOLUTION_REQUIRED_FIELDS.every((field) => isFilled(raw[field]));
}

/**
 * The resolution block is optional as a whole but all-or-nothing once started:
 * a half-filled resolution cannot be persisted (the API requires number,
 * prefix, range and both validity dates), and silently dropping it is exactly
 * the data-loss bug this form had. Reporting it as a group error surfaces the
 * problem to the user instead.
 */
function resolutionCompletenessValidator(
  group: AbstractControl,
): ValidationErrors | null {
  const raw = group.getRawValue() as Record<string, unknown>;
  if (!hasAnyResolutionValue(raw)) return null;
  const missing = RESOLUTION_REQUIRED_FIELDS.filter(
    (field) => !isFilled(raw[field]),
  );
  return missing.length ? { resolutionIncomplete: missing } : null;
}

/**
 * Validadores del `software_id` según la rama del wizard (QUI-657).
 *
 * En la rama «no tengo certificado» la DIAN todavía no emitió el identificador
 * —lo tramita la plataforma con los documentos de identidad del tenant—, así que
 * exigirlo deja al usuario atrapado en un paso que no puede completar por
 * definición. Se cae el `required`, NO el formato: `dianUuidValidator` ya deja
 * pasar el vacío y solo se pronuncia sobre lo que el usuario sí escribió, y un
 * UUID mal copiado es peor que uno ausente (el ausente detiene el flujo aquí, el
 * mal copiado llega a la DIAN y el documento nunca clasifica).
 */
function buildSoftwareIdValidators(
  requireDianCredentials: boolean,
): ValidatorFn[] {
  return requireDianCredentials
    ? [Validators.required, dianUuidValidator]
    : [dianUuidValidator];
}

/**
 * Validadores de grupo según la rama del wizard (QUI-657).
 *
 * `resolutionCompletenessValidator` es la única credencial DIAN de los tres: la
 * resolución de numeración también la emite la DIAN, y en la rama sin
 * certificado el tenant no la tiene. Los otros dos se quedan en AMBAS ramas
 * porque validan la IDENTIDAD del tenant, no sus credenciales: el DV entra en el
 * CUFE y un rango invertido no puede emitir nada, con o sin certificado.
 *
 * Con el validador fuera, «hay algo escrito en la resolución» deja de implicar
 * «la resolución se puede guardar» — de ahí `hasCompleteResolutionInput()`.
 */
function buildGroupValidators(requireDianCredentials: boolean): ValidatorFn[] {
  return [
    ...(requireDianCredentials ? [resolutionCompletenessValidator] : []),
    // El DV entra en el CUFE: un dígito equivocado hace que la DIAN recompute
    // otro hash y rechace cada documento, con el consecutivo gastado. Es de
    // grupo porque compara `nit` con `nit_dv`.
    nitDvValidator,
    // Un rango invertido produce una resolución que no puede emitir nada.
    rangeOrderValidator('resolution_range_from', 'resolution_range_to'),
  ];
}

export interface DianConfigValue {
  name: string;
  nit_type: string;
  nit: string;
  nit_dv: string;
  environment: DianEnvironment;
  software_id: string;
  software_pin: string;
  test_set_id: string;
  resolution_number: string;
  resolution_prefix: string;
  resolution_range_from: number | null;
  resolution_range_to: number | null;
  resolution_valid_from: string;
  resolution_valid_to: string;
  /** Date the DIAN issued the numbering authorization. Required by the API. */
  resolution_date: string;
  /**
   * ClTec — technical key the DIAN prints alongside the numbering resolution,
   * in hex: 40 chars (SHA-1) or 64 (SHA-256), never anything in between. Feeds
   * the CUFE hash, so an invoice cannot be validated without it. Optional at the
   * form level because contingency ranges have none.
   */
  resolution_technical_key: string;
  certificate_password: string;
  /** File reference. Parent component uploads via multipart endpoint. */
  certificate_file: File | null;
}

interface DianConfigControls {
  name: FormControl<string>;
  nit_type: FormControl<string>;
  nit: FormControl<string>;
  nit_dv: FormControl<string>;
  environment: FormControl<DianEnvironment>;
  software_id: FormControl<string>;
  software_pin: FormControl<string>;
  test_set_id: FormControl<string>;
  resolution_number: FormControl<string>;
  resolution_prefix: FormControl<string>;
  resolution_range_from: FormControl<number | null>;
  resolution_range_to: FormControl<number | null>;
  resolution_valid_from: FormControl<string>;
  resolution_valid_to: FormControl<string>;
  resolution_date: FormControl<string>;
  resolution_technical_key: FormControl<string>;
  certificate_password: FormControl<string>;
}

@Component({
  selector: 'app-dian-config-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    IconComponent,
    FileUploadDropzoneComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-5">
      <!-- Identificación -->
      <section class="space-y-4">
        <h3 class="text-sm font-semibold text-text-primary">Identificación</h3>
        <app-input
          label="Nombre de la configuración"
          formControlName="name"
          [required]="true"
          placeholder="Ej: DIAN Producción"
        ></app-input>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <app-selector
            label="Tipo documento"
            formControlName="nit_type"
            [options]="nitTypeOptions"
          ></app-selector>
          <app-input
            label="NIT"
            formControlName="nit"
            [required]="true"
            placeholder="900123456"
          ></app-input>
          <app-input
            label="DV"
            formControlName="nit_dv"
            placeholder="0"
          ></app-input>
        </div>
        @if (nitDvMessage()) {
          <p class="text-xs text-error" role="alert">
            {{ nitDvMessage() }}
          </p>
        }
      </section>

      <!-- Software -->
      <section class="space-y-4">
        <h3 class="text-sm font-semibold text-text-primary">Software DIAN</h3>
        <app-selector
          label="Ambiente"
          formControlName="environment"
          [options]="environmentOptions"
          [required]="true"
        ></app-selector>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Software ID"
            formControlName="software_id"
            [required]="true"
            placeholder="ID registrado en DIAN"
          ></app-input>
          <app-input
            label="Software PIN"
            type="password"
            formControlName="software_pin"
            placeholder="PIN del software"
          ></app-input>
        </div>
        <app-input
          label="Test Set ID"
          formControlName="test_set_id"
          placeholder="ID del set de pruebas (opcional)"
        ></app-input>
      </section>

      <!-- Resolución -->
      <section class="space-y-4">
        <h3 class="text-sm font-semibold text-text-primary">Resolución DIAN</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Número de resolución"
            formControlName="resolution_number"
            placeholder="Ej: 18760000001"
          ></app-input>
          <app-input
            label="Prefijo"
            formControlName="resolution_prefix"
            placeholder="Ej: FE, SETP"
          ></app-input>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Rango desde"
            type="number"
            formControlName="resolution_range_from"
            placeholder="1"
          ></app-input>
          <app-input
            label="Rango hasta"
            type="number"
            formControlName="resolution_range_to"
            placeholder="5000000"
          ></app-input>
        </div>
        @if (rangeOrderMessage()) {
          <p class="text-xs text-error" role="alert">
            {{ rangeOrderMessage() }}
          </p>
        }
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Vigente desde"
            type="date"
            formControlName="resolution_valid_from"
          ></app-input>
          <app-input
            label="Vigente hasta"
            type="date"
            formControlName="resolution_valid_to"
          ></app-input>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            label="Fecha de la resolución"
            type="date"
            formControlName="resolution_date"
          ></app-input>
          <div class="space-y-1.5">
            <app-input
              label="Clave técnica (ClTec)"
              formControlName="resolution_technical_key"
              [placeholder]="
                storedTechnicalKeyLength() !== null
                  ? 'Déjalo vacío para conservar la guardada'
                  : '40 o 64 caracteres del portal DIAN'
              "
              helperText="Aparece junto a la resolución en el portal. Sin ella la DIAN rechaza el CUFE."
            ></app-input>

            @if (storedTechnicalKeyLength() !== null) {
              @if (storedTechnicalKeyMalformed()) {
                <p
                  class="flex items-start gap-1.5 text-xs text-error"
                  role="alert"
                >
                  <app-icon
                    name="alert-triangle"
                    [size]="13"
                    class="mt-0.5 flex-shrink-0"
                  />
                  <span>
                    La clave guardada tiene
                    {{ storedTechnicalKeyLength() }} caracteres, y la DIAN la
                    emite en hexadecimal con 40 (SHA-1) o 64 (SHA-256). Una
                    longitud intermedia es una clave truncada al copiarla: con
                    ella el CUFE se calcula mal y el documento se rechaza —
                    gastando el consecutivo autorizado. Cópiala de nuevo del
                    portal DIAN o del servicio de Rangos de Numeración.
                  </span>
                </p>
              } @else {
                <p
                  class="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"
                >
                  <app-icon
                    name="shield-check"
                    [size]="13"
                    class="flex-shrink-0 text-success"
                  />
                  Ya hay una clave guardada, de
                  {{ storedTechnicalKeyLength() }} caracteres. No se muestra por
                  seguridad: es el secreto con el que se firma el CUFE.
                </p>
              }
            }
          </div>
        </div>
        @if (resolutionIncomplete()) {
          <p class="text-xs text-error" role="alert">
            Completa todos los datos de la resolución para poder guardarla: falta
            {{ resolutionMissingLabels() }}.
          </p>
        }
      </section>

      <!-- Certificado -->
      @if (showCertificateSection()) {
        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-text-primary">
            Certificado digital
          </h3>

          @if (hasCertificate()) {
            <div
              class="flex items-start gap-3 p-3 rounded-lg border border-border"
            >
              <app-icon
                [name]="certificateExpired() ? 'alert-triangle' : 'check-circle'"
                [size]="18"
                class="mt-0.5"
                [class.text-warning]="certificateExpired()"
                [class.text-primary]="!certificateExpired()"
              ></app-icon>
              <div class="text-sm">
                <p class="font-medium text-text-primary">Certificado cargado</p>
                @if (certificateExpiryDisplay()) {
                  @if (certificateExpired()) {
                    <p class="text-warning">
                      Vencido el {{ certificateExpiryDisplay() }}. Puedes
                      continuar, pero renueva el certificado pronto.
                    </p>
                  } @else {
                    <p class="text-text-secondary">
                      Vigente hasta {{ certificateExpiryDisplay() }}
                    </p>
                  }
                }
                <p class="text-xs text-text-secondary mt-1">
                  No necesitas volver a subirlo. Sube un archivo solo si deseas
                  reemplazarlo.
                </p>
              </div>
            </div>
          }

          @if (!hideCertificate()) {
            <!--
              Bloque de cert. Envuelto en @if para que la rama "no tengo cert"
              del wizard (QUI-657) lo oculte. El FormControl certificate_password
              sigue existiendo con el sentinel MASKED_SECRET; el backend solo
              recibe el pin si el usuario lo tipeó de verdad.
            -->
            <app-file-upload-dropzone
              accept=".p12,.pfx"
              icon="upload-cloud"
              [label]="hasCertificate() ? 'Haga clic para reemplazar el certificado' : 'Subir certificado .p12'"
              [helperText]="selectedFileName() ? selectedFileName() : 'Obligatorio · Solo .p12 o .pfx con contraseña'"
              (fileSelected)="onFileSelected($event)"
              (fileRemoved)="removeFile()"
            ></app-file-upload-dropzone>
            <app-input
              label="Contraseña del certificado"
              type="password"
              formControlName="certificate_password"
              placeholder="Contraseña del archivo .p12"
              helperText="Solo se pide cuando subes un archivo nuevo."
            ></app-input>
          }
        </section>
      }
    </form>
  `,
})
export class DianConfigFormComponent {
  readonly initialValue = input<Partial<DianConfigValue> | null>(null);
  readonly disabled = input<boolean>(false);

  /**
   * B3: when the tenant already has a digital certificate uploaded, the form
   * renders a "certificado cargado" state and re-upload is optional (the whole
   * DIAN step remains optional to advance).
   */
  readonly hasCertificate = input<boolean>(false);
  readonly certificateExpiry = input<string | null>(null);

  /**
   * QUI-657 bifurcation step wiring. Cuando el usuario eligió la rama
   * "no tengo certificado" en el wizard, el step pasa `hideCertificate=true`
   * y este form esconde tanto el dropzone del `.p12` como el input de la
   * contraseña. El FormControl `certificate_password` sigue existiendo
   * (sentinel MASKED_SECRET) para no invalidar validaciones de la prefill;
   * `persistConfigAndCertificate` ya solo envía el cert si el file + pin
   * están presentes.
   */
  readonly hideCertificate = input<boolean>(false);

  /**
   * Si el formulario puede exigir las credenciales que emite la DIAN.
   *
   * `false` es la rama de documentos de identidad (QUI-657): la plataforma
   * tramita la habilitación por el tenant, así que en ese momento no existen ni
   * el `software_id` ni la resolución de numeración. Exigirlos ahí es pedirle al
   * usuario un dato que nadie le ha entregado todavía, y el paso se vuelve
   * imposible de completar — ese es el bloqueo que este input levanta.
   *
   * NO afecta `name`, `nit`, `nit_dv` ni `environment`: esos son la identidad del
   * tenant, la sabe él, y se exigen igual en las dos ramas.
   */
  readonly requireDianCredentials = input<boolean>(true);

  /**
   * La sección «Certificado digital» se pinta solo si tiene algo que decir.
   *
   * El `<section>` y su `<h3>` vivían FUERA del `@if (!hideCertificate())`, así
   * que la rama sin certificado seguía anunciando un encabezado sobre el vacío —
   * exactamente lo contrario de lo que el usuario acababa de declarar. Se
   * conserva el caso «ya hay certificado cargado»: ahí el banner informa aunque
   * el bloque de subida esté oculto, y perderlo sería esconder un dato que el
   * tenant sí tiene.
   */
  readonly showCertificateSection = computed<boolean>(
    () => !this.hideCertificate() || this.hasCertificate(),
  );

  /**
   * Longitud de la clave técnica YA GUARDADA, o `null` si no hay ninguna.
   *
   * Nunca el valor: la ClTec es el secreto con el que se hashea el CUFE de
   * cada factura de la resolución, y este formulario vive en el navegador. Sin
   * este dato el campo se vería vacío y el usuario no podría distinguir «no
   * hay clave» de «la hay pero no te la muestro», que son dos situaciones con
   * consecuencias opuestas: en la primera la emisión falla, en la segunda
   * reescribirla a ciegas es lo que la rompe.
   *
   * La longitud es además el diagnóstico: la ClTec es un hash en hexadecimal, y
   * la DIAN emite las dos familias —SHA-1 (40) y SHA-256 (64)—, así que un 38 en
   * pantalla delata de inmediato la clave truncada que en producción quemó un
   * consecutivo autorizado sin que ningún validador lo atajara. Lo que NO se
   * puede hacer es dar por sentada una sola anchura: hacerlo rechazó una clave
   * legítima de 64 (ver `TECHNICAL_KEY_VALID_LENGTHS`).
   */
  readonly storedTechnicalKeyLength = input<number | null>(null);

  /**
   * `true` cuando hay clave guardada y su longitud no es ninguna de las que la
   * DIAN emite (40 hex de SHA-1 o 64 de SHA-256) — es decir, está truncada.
   */
  readonly storedTechnicalKeyMalformed = computed<boolean>(() => {
    const length = this.storedTechnicalKeyLength();
    return length !== null && !TECHNICAL_KEY_VALID_LENGTHS.includes(length);
  });

  readonly valueChange = output<DianConfigValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly selectedFileName = signal<string>('');

  /** Formatted certificate expiry (date-only, UTC-safe) for display. */
  readonly certificateExpiryDisplay = computed(() => {
    const raw = this.certificateExpiry();
    return raw ? formatDateOnlyUTC(raw) : null;
  });

  /** True when the existing certificate is past its validity date. */
  readonly certificateExpired = computed(() => {
    const raw = this.certificateExpiry();
    if (!raw) return false;
    const expiry = new Date(raw).getTime();
    return !Number.isNaN(expiry) && expiry < Date.now();
  });

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<DianConfigControls> = new FormGroup<DianConfigControls>(
    {
      name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      nit_type: new FormControl('NIT', { nonNullable: true }),
      // VALIDADORES DE FORMATO, espejo del DTO del backend.
      //
      // Esta es la cuarta puerta de entrada a una configuración DIAN —la usa el
      // asistente de activación fiscal— y tenía cuatro `required` pelados. Sin
      // validar la forma, un `software_id` mal copiado llega al backend, que lo
      // rechaza con `@IsUUID`, o peor: llega a la DIAN y el documento nunca
      // clasifica, indistinguible de una cola atascada.
      nit: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, nitFormatValidator],
      }),
      nit_dv: new FormControl('', { nonNullable: true }),
      environment: new FormControl<DianEnvironment>('test', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      // Los validadores arrancan en la rama exigente (el default del input) y el
      // `effect` del constructor los re-aplica si el wizard dice lo contrario.
      software_id: new FormControl('', {
        nonNullable: true,
        validators: buildSoftwareIdValidators(true),
      }),
      // `software_pin` y `test_set_id` NO llevan `required` en ninguna rama, y
      // sus validadores de formato ya devuelven `null` ante el vacío
      // (`dianSoftwarePinValidator` / `dianUuidValidator`): un campo en blanco
      // pasa, uno escrito se valida. No hay nada que relajar por rama.
      software_pin: new FormControl('', {
        nonNullable: true,
        validators: [dianSoftwarePinValidator],
      }),
      test_set_id: new FormControl('', {
        nonNullable: true,
        validators: [dianUuidValidator],
      }),
      resolution_number: new FormControl('', { nonNullable: true }),
      resolution_prefix: new FormControl('', { nonNullable: true }),
      resolution_range_from: new FormControl<number | null>(null),
      resolution_range_to: new FormControl<number | null>(null),
      resolution_valid_from: new FormControl('', { nonNullable: true }),
      resolution_valid_to: new FormControl('', { nonNullable: true }),
      resolution_date: new FormControl('', { nonNullable: true }),
      resolution_technical_key: new FormControl('', { nonNullable: true }),
      certificate_password: new FormControl('', { nonNullable: true }),
    },
    {
      validators: buildGroupValidators(true),
    },
  );

  /**
   * True when the user supplied enough resolution data to persist a row. The
   * parent step uses this to decide whether to POST a resolution — the block is
   * optional as a whole, but all-or-nothing once started.
   */
  hasResolutionInput(): boolean {
    return hasAnyResolutionValue(this.form.getRawValue());
  }

  /**
   * True cuando TODOS los campos de la resolución están llenos (persistible).
   *
   * Distinto de `hasResolutionInput()`, al que le basta UNO. La diferencia solo
   * importa cuando `requireDianCredentials()` es `false`: ahí el validador de
   * grupo ya no exige completar el bloque, así que un formulario válido puede
   * llevar media resolución escrita. Si el padre decidiera el POST con
   * `hasResolutionInput()`, mandaría ese cuerpo incompleto y el backend lo
   * rechazaría con un 400 que el usuario no puede relacionar con nada.
   */
  hasCompleteResolutionInput(): boolean {
    return hasAllResolutionValues(this.form.getRawValue());
  }

  /**
   * Lista legible, en español, de todo lo que impide continuar.
   *
   * POR QUÉ EXISTE — el callejón sin salida que reportó el usuario:
   * `app-input` solo pinta el error de un control cuando está `touched`, y el
   * único sitio que marca el formulario entero como tocado es el `submit()` del
   * paso padre. Pero a `submit()` no se llega: el shell del asistente deshabilita
   * «Continuar» mientras el formulario sea inválido. El ciclo se cierra sobre sí
   * mismo — inválido → botón muerto → sin submit → sin `touched` → error
   * invisible → el usuario no sabe qué corregir → sigue inválido.
   *
   * Esta lista lo rompe diciendo en voz alta qué falta, sin depender de que el
   * usuario haya tocado el campo. La consume el paso padre para pintar el bloque
   * «Para continuar falta: …».
   *
   * Respeta la bifurcación sin repetir su regla: lee el veredicto REAL del
   * formulario, así que lo que `requireDianCredentials()` dejó de exigir tampoco
   * produce error y por tanto no aparece acá. No hay una segunda tabla que
   * mantener en sincronía con la primera.
   */
  describeInvalidFields(): string[] {
    const items: string[] = [];

    // El cast explícito porque `DianConfigControls` es una interfaz y no tiene
    // firma de índice: sin él `Object.entries` cae en la sobrecarga que devuelve
    // `any`, y perderíamos el chequeo justo donde se recorren los controles.
    const controls = Object.entries(this.form.controls) as [
      string,
      AbstractControl,
    ][];

    for (const [key, control] of controls) {
      if (!control.invalid || !control.errors) continue;
      const label = CONTROL_LABELS[key] ?? key;
      items.push(`${label}: ${describeControlErrors(control.errors)}`);
    }

    // Los errores de GRUPO no cuelgan de ningún control, así que ningún
    // `app-input` los pinta jamás: sin esta parte el usuario vería la lista
    // vacía y el botón muerto al mismo tiempo, que es el peor de los mundos.
    const groupErrors = this.form.errors ?? {};

    if (groupErrors['nitDv']) {
      items.push(
        `${CONTROL_LABELS['nit_dv']}: ${DIAN_VALIDATION_MESSAGES['nitDv']}`,
      );
    }

    if (groupErrors['rango_final_invalid']) {
      items.push(
        `${CONTROL_LABELS['resolution_range_to']}: ${DIAN_VALIDATION_MESSAGES['rango_final_invalid']}`,
      );
    }

    if (groupErrors['resolutionIncomplete']) {
      items.push(
        `Resolución DIAN: complétala para poder guardarla; falta ${this.resolutionMissingLabels()}.`,
      );
    }

    return items;
  }

  readonly nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'TI', label: 'Tarjeta de Identidad' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT Extranjería' },
  ];

  readonly environmentOptions: SelectorOption[] = [
    { value: 'test', label: 'Habilitación (Pruebas)' },
    { value: 'production', label: 'Producción' },
  ];

  /**
   * Missing resolution fields, mirrored into a signal because a `computed` that
   * reads `FormControl.value` is NOT reactive under Zoneless — the form does not
   * notify the signal graph. Updated from `valueChanges` and after every patch.
   */
  private readonly resolutionMissing = signal<readonly string[]>([]);
  readonly resolutionIncomplete = computed(
    () => this.resolutionMissing().length > 0,
  );
  readonly resolutionMissingLabels = computed(() =>
    this.resolutionMissing()
      .map((field) => RESOLUTION_FIELD_LABELS[field] ?? field)
      .join(', '),
  );

  /**
   * Mirror of `form.errors` into the signal graph.
   *
   * Same Zoneless rationale as `resolutionMissing`: `FormGroup.errors` is NOT a
   * signal, so a `computed` that reads it without notifying the graph produces
   * stale values. We push the snapshot from `statusChanges` so the templates
   * that depend on `nitDvMessage` / `rangeOrderMessage` re-render when the
   * group-level validators flip.
   */
  private readonly formErrors = signal<ValidationErrors | null>(null);

  /** Mensaje del error de grupo `nitDv`, o `null` si el DV cuadra. */
  readonly nitDvMessage = computed(() =>
    this.formErrors()?.['nitDv'] ? DIAN_VALIDATION_MESSAGES['nitDv'] : null,
  );

  /** Mensaje del error de grupo `rango_final_invalid`, o `null` si el rango es válido. */
  readonly rangeOrderMessage = computed(() =>
    this.formErrors()?.['rango_final_invalid']
      ? DIAN_VALIDATION_MESSAGES['rango_final_invalid']
      : null,
  );

  /**
   * Espejo de `describeInvalidFields()` en el grafo de señales.
   *
   * Mismo motivo que `resolutionMissing` y `formErrors`: ni `FormGroup.errors`
   * ni `FormControl.errors` son señales, así que un `computed` que los leyera se
   * quedaría con la foto del primer render. Se empuja desde los mismos puntos de
   * sincronización, para que un padre que quiera pintar la lista en su template
   * no tenga que llamar al método en cada ciclo de detección.
   */
  private readonly invalidFieldsState = signal<readonly string[]>([]);
  readonly invalidFields = this.invalidFieldsState.asReadonly();

  constructor() {
    /**
     * Re-aplica los validadores cuando el wizard cambia de rama.
     *
     * VA PRIMERO a propósito: el `effect` de `initialValue` parcha y emite, y si
     * corriera antes que este el padre recibiría un veredicto calculado con los
     * validadores de la rama equivocada.
     *
     * `emitEvent: false` evita que `updateValueAndValidity` dispare
     * `valueChanges`/`statusChanges` —serían dos emisiones por un solo cambio—,
     * a cambio de espejar los errores a mano. Y la validez se vuelve a emitir
     * explícitamente porque un `FormGroup` no notifica al grafo de señales: sin
     * esa línea el padre conserva el veredicto viejo hasta que el usuario teclee
     * algo, que es justo el botón «Continuar» que se queda muerto.
     */
    effect(() => {
      const require = this.requireDianCredentials();

      const softwareId = this.form.controls.software_id;
      softwareId.setValidators(buildSoftwareIdValidators(require));
      softwareId.updateValueAndValidity({ emitEvent: false });

      this.form.setValidators(buildGroupValidators(require));
      this.form.updateValueAndValidity({ emitEvent: false });

      this.syncResolutionErrors();
      this.touchPrefilledInvalidControls();
      this.syncGroupErrors();
      this.emitValidity();
    });

    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.syncResolutionErrors();
        this.touchPrefilledInvalidControls();
        this.syncGroupErrors();
        this.emitCurrent();
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncResolutionErrors();
        this.syncGroupErrors();
        this.emitCurrent();
      });

    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // `syncResolutionErrors` va también acá —y no solo en `valueChanges`—
        // porque `describeInvalidFields()` lee su espejo: un cambio de estado
        // sin cambio de valor lo dejaría describiendo la foto anterior.
        this.syncResolutionErrors();
        this.syncGroupErrors();
      });
  }

  /**
   * Marca `touched` los controles que llegan PRECARGADOS con un valor inválido.
   *
   * Este formulario casi nunca lo llena alguien a mano de cero: se precarga con
   * la prefill del asistente, con la identidad fiscal heredada y con lo que lee
   * el escáner IA del set de pruebas. Ninguno de esos valores pasa por un blur
   * del usuario, así que llegan inválidos y MUDOS —`app-input` calla mientras el
   * control no esté `touched`—, y el paso queda bloqueado sin decir por qué.
   *
   * Solo los que ya traen valor: marcar también los vacíos pintaría el
   * formulario en rojo de entrada, acusando al usuario de algo que todavía no ha
   * hecho. La regla es «si ya hay un valor y está mal, dilo ya».
   */
  private touchPrefilledInvalidControls(): void {
    const controls = Object.values(this.form.controls) as AbstractControl[];

    for (const control of controls) {
      if (isFilled(control.value) && control.invalid) {
        control.markAsTouched({ onlySelf: true });
      }
    }
  }

  /** Mirrors the group validator's result into the signal graph. */
  private syncResolutionErrors(): void {
    const missing = this.form.errors?.['resolutionIncomplete'];
    this.resolutionMissing.set(Array.isArray(missing) ? missing : []);
  }

  /**
   * Mirrors `form.errors` into `formErrors` so `computed` consumers react, y de
   * paso refresca la lista de faltantes: sale de la misma foto de errores, y
   * separarlas solo abriría la puerta a que un punto de sincronización actualice
   * una y se olvide de la otra.
   */
  private syncGroupErrors(): void {
    this.formErrors.set(this.form.errors ?? null);
    this.invalidFieldsState.set(this.describeInvalidFields());
  }

  getValue(): DianConfigValue {
    return this.toValue();
  }

  /**
   * Precarga los campos que un escáner IA leyó, sobrescribiendo lo que hubiera.
   *
   * POR QUÉ NO SE REUSA `initialValue`: ese input es el snapshot de la prefill
   * y su `effect` vuelve a correr cada vez que el padre lo recalcula. Si el
   * escaneo entrara por ahí, una recarga de la prefill repondría los datos
   * viejos encima de lo que el usuario acaba de aceptar. Acá el patch es un
   * evento puntual, y `emitCurrent()` deja al padre con el valor nuevo sin
   * esperar al `valueChanges` (el patch va con `emitEvent: false` para no
   * disparar dos emisiones por un solo cambio).
   *
   * `markAsDirty` importa: sin él, el formulario recién precargado se ve
   * intacto y el usuario puede salir del paso creyendo que no hay nada por
   * guardar.
   */
  applyScan(patch: Partial<DianConfigValue>): void {
    if (Object.keys(patch).length === 0) return;
    this.form.patchValue(patch, { emitEvent: false });
    this.form.markAsDirty();
    this.syncResolutionErrors();
    // Lo que lee el escáner es precisamente lo que nadie va a tocar: si el OCR
    // dejó un UUID a medias, el error tiene que verse ya, no tras un blur que no
    // va a ocurrir.
    this.touchPrefilledInvalidControls();
    this.syncGroupErrors();
    this.emitCurrent();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── File handling ─────────────────────────────────────────
  /**
   * Vinculado al `(fileSelected)` del `<app-file-upload-dropzone>`,
   * que emite `File` directamente (no el `Event` nativo). El dropzone
   * ya valida extensión + tamaño interno.
   */
  onFileSelected(file: File): void {
    this.setFile(file);
  }

  /**
   * Vinculado al `(fileRemoved)` del `<app-file-upload-dropzone>`.
   * El form-control `certificate_password` NO se limpia — el sentinel
   * `MASKED_SECRET` que el padre inyectó indica "el cert sigue cargado
   * en backend, no reescribas este campo a vacío".
   */
  removeFile(): void {
    this.setFile(null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith('.p12') || file.name.endsWith('.pfx'))) {
      this.setFile(file);
    }
  }

  private setFile(file: File | null): void {
    this.selectedFile.set(file);
    this.selectedFileName.set(file?.name ?? '');
    this.emitCurrent();
  }

  private toValue(): DianConfigValue {
    return {
      ...this.form.getRawValue(),
      certificate_file: this.selectedFile(),
    };
  }

  /**
   * Publica el veredicto de validez, y nada más.
   *
   * Separado de `emitCurrent` porque recalcular validadores cambia la VALIDEZ sin
   * tocar el VALOR: emitir también `valueChange` ahí anunciaría un cambio que no
   * ocurrió, y el padre tiene todo el derecho a tratarlo como edición del
   * usuario.
   */
  private emitValidity(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
  }

  private emitCurrent(): void {
    this.emitValidity();
    this.valueChange.emit(this.toValue());
  }
}
