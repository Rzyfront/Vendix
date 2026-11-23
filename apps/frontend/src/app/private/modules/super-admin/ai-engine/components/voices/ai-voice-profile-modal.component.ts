import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  AI_VOICE_SAMPLE_MAX_LENGTH,
  AiVoiceProfile,
  AiVoiceProfileWriteDto,
  AiVoiceSpeechConfig,
} from '../../interfaces';
import { AiVoicesService } from '../../services/ai-voices.service';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

interface VoiceProfileForm {
  config_id: FormControl<string>;
  voice_id: FormControl<string>;
  name: FormControl<string>;
  language: FormControl<string>;
  speed: FormControl<number | null>;
  vol: FormControl<number | null>;
  sample_text: FormControl<string>;
  is_active: FormControl<boolean>;
}

/** Crear/editar una voz del catálogo (superadmin). */
@Component({
  selector: 'app-ai-voice-profile-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="isOpenChange.emit(false)"
      size="md"
      [title]="voice() ? 'Editar voz' : 'Registrar voz'"
      [subtitle]="
        voice()
          ? 'Editando: ' + voice()!.name
          : 'Agrega una voz de lectura al catálogo'
      "
    >
      <form
        [formGroup]="form"
        (ngSubmit)="save()"
        class="space-y-4"
        aria-label="Formulario de voz"
      >
        @if (configOptions().length === 0) {
          <p
            class="rounded-lg border border-border bg-background p-3 text-sm text-text-secondary"
            role="status"
          >
            Primero registra un proveedor de voz en la pestaña de configuraciones.
          </p>
        }
        <app-selector
          label="Proveedor de voz"
          placeholder="Selecciona un proveedor"
          [options]="configOptions()"
          [formControl]="form.controls.config_id"
          [required]="true"
          [disabled]="saving()"
        ></app-selector>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <app-input
            formControlName="name"
            label="Nombre"
            placeholder="Voz cálida"
            [required]="true"
            [control]="form.controls.name"
            [disabled]="saving()"
          ></app-input>
          <app-input
            formControlName="voice_id"
            label="Id de voz"
            placeholder="Id de la voz en el proveedor"
            [required]="true"
            [control]="form.controls.voice_id"
            [disabled]="saving()"
          ></app-input>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <app-input
            formControlName="language"
            label="Idioma"
            placeholder="es"
            [required]="true"
            [control]="form.controls.language"
            [disabled]="saving()"
            helperText="Código corto, por ejemplo es"
          ></app-input>
          <app-input
            formControlName="speed"
            label="Velocidad"
            type="number"
            step="0.1"
            min="0.5"
            [control]="form.controls.speed"
            [disabled]="saving()"
            helperText="Opcional, 0,5 a 2"
          ></app-input>
          <app-input
            formControlName="vol"
            label="Volumen"
            type="number"
            step="0.1"
            min="0.1"
            [control]="form.controls.vol"
            [disabled]="saving()"
            helperText="Opcional, 0,1 a 10"
          ></app-input>
        </div>
        <app-input
          formControlName="sample_text"
          label="Texto de muestra"
          placeholder="Hola, soy Vex. ¿En qué te ayudo hoy?"
          [control]="form.controls.sample_text"
          [disabled]="saving()"
          [helperText]="'Opcional, máximo ' + sampleMax + ' caracteres'"
        ></app-input>
        <label class="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            formControlName="is_active"
            class="rounded border-border text-primary focus:ring-primary"
          />
          <span class="text-sm text-text-primary">Activa</span>
        </label>
      </form>

      <ng-container slot="footer">
        <div class="flex justify-end gap-3">
          <app-button
            variant="outline"
            (clicked)="isOpenChange.emit(false)"
            [disabled]="saving()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="save()"
            [disabled]="form.invalid || saving()"
            [loading]="saving()"
          >
            {{ voice() ? 'Guardar cambios' : 'Registrar voz' }}
          </app-button>
        </div>
      </ng-container>
    </app-modal>
  `,
})
export class AiVoiceProfileModalComponent {
  private readonly api = inject(AiVoicesService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input<boolean>(false);
  readonly voice = input<AiVoiceProfile | null>(null);
  readonly configs = input<AiVoiceSpeechConfig[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly saved = output<AiVoiceProfile>();

  protected readonly sampleMax = AI_VOICE_SAMPLE_MAX_LENGTH;
  protected readonly saving = signal(false);

  protected readonly configOptions = computed<SelectorOption[]>(() =>
    this.configs().map((c) => ({
      value: String(c.id),
      label: `${c.provider} · ${c.model_id} (${c.label})`,
    })),
  );

  protected readonly form = new FormGroup<VoiceProfileForm>({
    config_id: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    voice_id: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    language: new FormControl('es', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(16)],
    }),
    speed: new FormControl<number | null>(null, [
      Validators.min(0.5),
      Validators.max(2),
    ]),
    vol: new FormControl<number | null>(null, [
      Validators.min(0.1),
      Validators.max(10),
    ]),
    sample_text: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(AI_VOICE_SAMPLE_MAX_LENGTH)],
    }),
    is_active: new FormControl(true, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;
      const voice = this.voice();
      untracked(() => this.patch(voice));
    });
  }

  private patch(voice: AiVoiceProfile | null): void {
    this.form.reset({
      config_id: voice ? String(voice.config.id) : '',
      voice_id: voice?.voice_id ?? '',
      name: voice?.name ?? '',
      language: voice?.language ?? 'es',
      speed: voice?.speed ?? null,
      vol: voice?.vol ?? null,
      sample_text: voice?.sample_text ?? '',
      is_active: voice?.is_active ?? true,
    });
  }

  private toNumberOrNull(value: number | string | null): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const raw = this.form.getRawValue();
    const dto: AiVoiceProfileWriteDto = {
      config_id: Number(raw.config_id),
      voice_id: raw.voice_id.trim(),
      name: raw.name.trim(),
      language: raw.language.trim() || 'es',
      speed: this.toNumberOrNull(raw.speed),
      vol: this.toNumberOrNull(raw.vol),
      sample_text: raw.sample_text.trim() ? raw.sample_text.trim() : null,
      is_active: raw.is_active,
    };
    const current = this.voice();
    const request$ = current
      ? this.api.update(current.id, dto)
      : this.api.create(dto);

    this.saving.set(true);
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.toast.success(current ? 'Voz actualizada' : 'Voz registrada');
        this.saved.emit(saved);
        this.isOpenChange.emit(false);
      },
      error: (error) => {
        this.saving.set(false);
        this.toast.error(extractApiErrorMessage(error));
      },
    });
  }
}
