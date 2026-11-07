import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
  StoreUserSelectComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../shared/components/index';
import { WorkflowFieldDef } from '../../../../../shared/workflows/contract/workflow-contract';
import { applyComputedFields } from '../../../../../shared/workflows/contract/workflow-expression';
import { evaluateCondition } from '../../../../../shared/workflows/contract/workflow-runtime';
import { WorkflowsApiService } from '../services/workflows-api.service';
import { toWorkflowError } from '../utils/workflow-errors.util';

export interface StageFormResult {
  ok: boolean;
  values: Record<string, unknown>;
}

type FieldValues = Record<string, unknown>;

/**
 * Renders the stage form of the current task from `form_fields`. State lives in
 * signals (zoneless); the parent reads it with `collect()` when the person
 * presses an outcome button. File fields upload on selection with `field_key`
 * and keep the returned `file_id` as the value.
 */
@Component({
  selector: 'app-workflow-stage-form',
  standalone: true,
  imports: [
    FormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    MultiSelectorComponent,
    ToggleComponent,
    StoreUserSelectComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <div class="flex flex-col gap-4">
      @for (field of visibleFields(); track field.key) {
        <div class="flex flex-col gap-1" [attr.data-field]="field.key">
          @switch (field.compute ? 'computed' : field.type) {
            @case ('computed') {
              <app-input
                [label]="field.label"
                [readonly]="true"
                [helperText]="field.help || 'Se calcula solo.'"
                [ngModel]="computedText(field)"
              />
            }
            @case ('textarea') {
              <app-textarea
                [label]="labelOf(field)"
                [rows]="4"
                [helperText]="field.help"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('number') {
              <app-input
                type="number"
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('money') {
              <app-input
                [currency]="true"
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('date') {
              <app-input
                type="date"
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('email') {
              <app-input
                type="email"
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('phone') {
              <app-input
                type="tel"
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('boolean') {
              <app-toggle
                [label]="labelOf(field)"
                [checked]="rawValue(field.key) === true"
                (toggled)="setValue(field.key, $event)"
              />
              @if (field.help) {
                <span class="text-xs text-text-secondary">{{
                  field.help
                }}</span>
              }
            }
            @case ('select') {
              <app-selector
                [label]="labelOf(field)"
                placeholder="Selecciona una opción"
                [options]="field.options ?? []"
                [value]="selectValue(field.key)"
                [errorText]="errors()[field.key] ?? ''"
                [helpText]="field.help ?? ''"
                (valueChange)="setValue(field.key, $event)"
              />
            }
            @case ('multiselect') {
              <app-multi-selector
                [label]="labelOf(field)"
                [options]="field.options ?? []"
                [errorText]="errors()[field.key] ?? ''"
                [helpText]="field.help ?? ''"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
            @case ('user') {
              <span class="text-sm font-medium text-text-primary">{{
                labelOf(field)
              }}</span>
              <app-store-user-select
                [value]="userValue(field.key)"
                (valueChange)="setValue(field.key, $event)"
              />
              @if (errors()[field.key]) {
                <span class="text-xs text-error" role="alert">{{
                  errors()[field.key]
                }}</span>
              }
            }
            @case ('file') {
              <span class="text-sm font-medium text-text-primary">{{
                labelOf(field)
              }}</span>
              @if (simulate()) {
                <app-toggle
                  label="Archivo simulado (no se sube nada)"
                  [checked]="rawValue(field.key) === 1"
                  (toggled)="setValue(field.key, $event ? 1 : null)"
                />
              } @else {
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    #picker
                    type="file"
                    class="hidden"
                    [attr.accept]="acceptOf(field)"
                    (change)="onFilePicked(field, $event)"
                  />
                  <app-button
                    variant="outline"
                    size="sm"
                    [loading]="uploading()[field.key] === true"
                    (clicked)="picker.click()"
                  >
                    <app-icon name="upload" [size]="14" slot="icon" />
                    {{
                      fileNames()[field.key]
                        ? 'Reemplazar archivo'
                        : 'Subir archivo'
                    }}
                  </app-button>
                  @if (fileNames()[field.key]) {
                    <span
                      class="flex items-center gap-1 text-sm text-text-primary"
                    >
                      <app-icon name="paperclip" [size]="14" />
                      {{ fileNames()[field.key] }}
                    </span>
                  } @else if (rawValue(field.key)) {
                    <span class="text-sm text-text-secondary"
                      >Archivo ya cargado</span
                    >
                  }
                </div>
              }
              @if (field.help) {
                <span class="text-xs text-text-secondary">{{
                  field.help
                }}</span>
              }
              @if (errors()[field.key]) {
                <span class="text-xs text-error" role="alert">{{
                  errors()[field.key]
                }}</span>
              }
            }
            @default {
              <app-input
                [label]="labelOf(field)"
                [helperText]="field.help ?? ''"
                [error]="errors()[field.key]"
                [ngModel]="rawValue(field.key)"
                (ngModelChange)="setValue(field.key, $event)"
              />
            }
          }
        </div>
      }
    </div>
  `,
})
export class WorkflowStageFormComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly fields = input<WorkflowFieldDef[]>([]);
  /** Data already stored in the request; seeds the form. */
  readonly instanceData = input<FieldValues>({});
  /** Not used in `simulate` mode (no uploads happen). */
  readonly instanceId = input<number>(0);
  /** Designer simulation: file fields become a "simulated file" toggle. */
  readonly simulate = input<boolean>(false);
  /** Changes when the stage (or request) changes; a plain reload keeps typed values. */
  readonly seedKey = input<string>('');

  readonly values = signal<FieldValues>({});
  readonly errors = signal<Partial<Record<string, string>>>({});
  readonly fileNames = signal<Record<string, string>>({});
  readonly uploading = signal<Record<string, boolean>>({});

  /**
   * P2.9: request data plus what the person typed, with the calculated fields
   * recomputed (the same function the server runs), so they update live.
   */
  readonly liveData = computed<FieldValues>(() =>
    applyComputedFields({ fields: this.fields() }, { ...this.instanceData(), ...this.values() }),
  );

  readonly visibleFields = computed(() => {
    const all = this.fields();
    const data = this.liveData();
    return all.filter(
      (field) =>
        !field.visible_when || evaluateCondition(field.visible_when, data, all),
    );
  });

  constructor() {
    effect(() => {
      this.seedKey();
      untracked(() => {
        const data = this.instanceData();
        const seed: FieldValues = {};
        for (const field of this.fields()) {
          if (data[field.key] !== undefined && data[field.key] !== null) {
            seed[field.key] = data[field.key];
          }
        }
        this.values.set(seed);
        this.errors.set({});
        this.fileNames.set({});
      });
    });
  }

  labelOf(field: WorkflowFieldDef): string {
    return field.required ? `${field.label} *` : field.label;
  }

  acceptOf(field: WorkflowFieldDef): string | null {
    return field.accept?.length ? field.accept.join(',') : null;
  }

  /** Calculated value as text for the read-only input ('' while it cannot be computed). */
  computedText(field: WorkflowFieldDef): string {
    const value = this.liveData()[field.key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' && field.type === 'money') return value.toLocaleString('es-CO');
    return String(value);
  }

  rawValue(key: string): unknown {
    return this.values()[key] ?? null;
  }

  selectValue(key: string): string | number | null {
    const value = this.values()[key];
    return typeof value === 'string' || typeof value === 'number'
      ? value
      : null;
  }

  userValue(key: string): number | null {
    const value = this.values()[key];
    return typeof value === 'number' ? value : null;
  }

  setValue(key: string, value: unknown): void {
    this.values.update((current) => ({ ...current, [key]: value }));
    if (this.errors()[key]) {
      this.errors.update((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  onFilePicked(field: WorkflowFieldDef, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (field.max_size_mb && file.size > field.max_size_mb * 1024 * 1024) {
      this.fail(
        field.key,
        `El archivo supera el máximo de ${field.max_size_mb} MB.`,
      );
      return;
    }
    this.uploading.update((current) => ({ ...current, [field.key]: true }));
    this.api
      .uploadInstanceFile(this.instanceId(), file, { field_key: field.key })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.setValue(field.key, result.file_id);
          this.fileNames.update((current) => ({
            ...current,
            [field.key]: file.name,
          }));
          this.uploading.update((current) => ({
            ...current,
            [field.key]: false,
          }));
        },
        error: (error) => {
          this.uploading.update((current) => ({
            ...current,
            [field.key]: false,
          }));
          this.fail(field.key, toWorkflowError(error).message);
        },
      });
  }

  /** Marks one field as invalid with the backend's own message. */
  fail(key: string, message: string): void {
    this.errors.update((current) => ({ ...current, [key]: message }));
  }

  /** Validates the visible fields and returns the typed values to submit. */
  collect(): StageFormResult {
    const errors: Record<string, string> = {};
    const out: FieldValues = {};
    if (this.isUploading()) {
      return { ok: false, values: out };
    }
    const raw = this.values();
    for (const field of this.visibleFields()) {
      // Calculated fields are read-only: the server computes them, never sent.
      if (field.compute) continue;
      const value = raw[field.key];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (field.type === 'boolean') {
        out[field.key] = value === true;
        continue;
      }
      if (empty) {
        if (field.required)
          errors[field.key] = `El campo "${field.label}" es obligatorio.`;
        continue;
      }
      if (field.type === 'number' || field.type === 'money') {
        const parsed =
          typeof value === 'number'
            ? value
            : Number(String(value).replace(',', '.'));
        if (Number.isFinite(parsed)) out[field.key] = parsed;
        else
          errors[field.key] =
            `El campo "${field.label}" debe ser un número válido.`;
      } else if (typeof value === 'string') {
        out[field.key] = value.trim();
      } else {
        out[field.key] = value;
      }
    }
    this.errors.set(errors);
    return { ok: Object.keys(errors).length === 0, values: out };
  }

  private isUploading(): boolean {
    return Object.values(this.uploading()).some(Boolean);
  }
}
