import {
  Component,
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
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { IconComponent } from '../../icon/icon.component';

export type DianEnvironment = 'test' | 'production';

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
      </section>

      <!-- Certificado -->
      <section class="space-y-3">
        <h3 class="text-sm font-semibold text-text-primary">
          Certificado digital
        </h3>
        <div
          class="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
          (click)="fileInput.click()"
          (dragover)="onDragOver($event)"
          (drop)="onDrop($event)"
        >
          <app-icon name="upload-cloud" [size]="28" class="text-gray-400 mx-auto mb-2"></app-icon>
          <p class="text-sm text-text-secondary">
            {{ selectedFileName() || 'Haga clic o arrastre su archivo .p12 aquí' }}
          </p>
          @if (!selectedFileName()) {
            <p class="text-xs text-gray-400 mt-1">Solo archivos .p12 o .pfx</p>
          }
        </div>
        <input
          #fileInput
          type="file"
          accept=".p12,.pfx"
          (change)="onFileSelected($event)"
          class="hidden"
        />
        <app-input
          label="Contraseña del certificado"
          type="password"
          formControlName="certificate_password"
          placeholder="Contraseña del archivo .p12"
        ></app-input>
      </section>
    </form>
  `,
})
export class DianConfigFormComponent {
  readonly initialValue = input<Partial<DianConfigValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<DianConfigValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly selectedFileName = signal<string>('');

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<DianConfigControls> = new FormGroup<DianConfigControls>(
    {
      name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      nit_type: new FormControl('NIT', { nonNullable: true }),
      nit: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      nit_dv: new FormControl('', { nonNullable: true }),
      environment: new FormControl<DianEnvironment>('test', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      software_id: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      software_pin: new FormControl('', { nonNullable: true }),
      test_set_id: new FormControl('', { nonNullable: true }),
      resolution_number: new FormControl('', { nonNullable: true }),
      resolution_prefix: new FormControl('', { nonNullable: true }),
      resolution_range_from: new FormControl<number | null>(null),
      resolution_range_to: new FormControl<number | null>(null),
      resolution_valid_from: new FormControl('', { nonNullable: true }),
      resolution_valid_to: new FormControl('', { nonNullable: true }),
      certificate_password: new FormControl('', { nonNullable: true }),
    },
  );

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

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) this.form.patchValue(v, { emitEvent: false });
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const isValid = this.form.valid;
        this.valid.set(isValid);
        this.validityChange.emit(isValid);
        this.valueChange.emit(this.toValue());
      });
  }

  getValue(): DianConfigValue {
    return this.toValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── File handling ─────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.setFile(file);
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
    this.valueChange.emit(this.toValue());
  }

  private toValue(): DianConfigValue {
    return {
      ...this.form.getRawValue(),
      certificate_file: this.selectedFile(),
    };
  }
}
