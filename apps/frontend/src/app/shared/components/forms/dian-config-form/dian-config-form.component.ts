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

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/** True when at least one resolution field carries a value. */
function hasAnyResolutionValue(raw: Record<string, unknown>): boolean {
  return RESOLUTION_REQUIRED_FIELDS.some((field) => isFilled(raw[field]));
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
   * ClTec — 40-char technical key the DIAN prints alongside the numbering
   * resolution. Feeds the CUFE hash, so an invoice cannot be validated without
   * it. Optional at the form level because contingency ranges have none.
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
          <app-input
            label="Clave técnica (ClTec)"
            formControlName="resolution_technical_key"
            placeholder="40 caracteres del portal DIAN"
            helperText="Aparece junto a la resolución en el portal. Sin ella la DIAN rechaza el CUFE."
          ></app-input>
        </div>
        @if (resolutionIncomplete()) {
          <p class="text-xs text-error" role="alert">
            Completa todos los datos de la resolución para poder guardarla: falta
            {{ resolutionMissingLabels() }}.
          </p>
        }
      </section>

      <!-- Certificado -->
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
      software_id: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, dianUuidValidator],
      }),
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
      validators: [
        resolutionCompletenessValidator,
        // El DV entra en el CUFE: un dígito equivocado hace que la DIAN recompute
        // otro hash y rechace cada documento, con el consecutivo gastado. Es de
        // grupo porque compara `nit` con `nit_dv`.
        nitDvValidator,
        // Un rango invertido produce una resolución que no puede emitir nada.
        rangeOrderValidator('resolution_range_from', 'resolution_range_to'),
      ],
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

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.syncResolutionErrors();
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
        this.emitCurrent();
      });
  }

  /** Mirrors the group validator's result into the signal graph. */
  private syncResolutionErrors(): void {
    const missing = this.form.errors?.['resolutionIncomplete'];
    this.resolutionMissing.set(Array.isArray(missing) ? missing : []);
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

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.toValue());
  }
}
