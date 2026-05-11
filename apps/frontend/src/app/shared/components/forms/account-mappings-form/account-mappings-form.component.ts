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
  FormControl,
  FormGroup,
  FormRecord,
  ReactiveFormsModule,
} from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';

export interface MappingKeyDef {
  key: string;
  label: string;
}

export interface AccountOption {
  id: number | string;
  code: string;
  name: string;
}

export interface AccountMappingsValue {
  mappings: Record<string, number | string | null>;
}

@Component({
  selector: 'app-account-mappings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SelectorComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-3">
      <div class="flex items-center justify-between mb-2">
        <p class="text-sm text-text-secondary">
          Asigne una cuenta del PUC a cada operación contable.
        </p>
        <app-button variant="outline" size="sm" (clicked)="applyDefaultsClicked.emit()">
          <app-icon name="zap" [size]="14"></app-icon>
          Aplicar defaults
        </app-button>
      </div>

      <div class="space-y-2">
        @for (def of mappingKeys(); track def.key) {
          <div
            class="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 md:items-center p-2 border border-border rounded-lg"
          >
            <label class="text-sm text-text-primary md:font-medium">
              {{ def.label }}
              <div class="text-xs text-text-secondary font-mono">{{ def.key }}</div>
            </label>
            <app-selector
              [formControlName]="def.key"
              [options]="accountOptions()"
              placeholder="Seleccione cuenta"
            ></app-selector>
          </div>
        }

        @if (mappingKeys().length === 0) {
          <p class="text-sm text-text-secondary text-center py-4">
            No hay claves de mapeo definidas.
          </p>
        }
      </div>
    </form>
  `,
})
export class AccountMappingsFormComponent {
  readonly initialValue = input<Partial<AccountMappingsValue> | null>(null);
  readonly disabled = input<boolean>(false);
  readonly mappingKeys = input<MappingKeyDef[]>([]);
  readonly availableAccounts = input<AccountOption[]>([]);

  readonly valueChange = output<AccountMappingsValue>();
  readonly validityChange = output<boolean>();
  readonly applyDefaultsClicked = output<void>();

  readonly valid = signal(true);

  private readonly destroyRef = inject(DestroyRef);

  readonly form = new FormRecord<FormControl<number | string | null>>({});

  readonly accountOptions = computed<SelectorOption[]>(() =>
    this.availableAccounts().map((a) => ({
      value: a.id,
      label: `${a.code} - ${a.name}`,
    })),
  );

  constructor() {
    // Build / rebuild controls based on mappingKeys input
    effect(() => {
      const keys = this.mappingKeys();
      const existing = new Set(Object.keys(this.form.controls));
      const wanted = new Set(keys.map((k) => k.key));

      // Add missing
      keys.forEach((k) => {
        if (!existing.has(k.key)) {
          this.form.addControl(
            k.key,
            new FormControl<number | string | null>(null),
            { emitEvent: false },
          );
        }
      });

      // Remove obsolete
      existing.forEach((k) => {
        if (!wanted.has(k)) this.form.removeControl(k, { emitEvent: false });
      });
    });

    effect(() => {
      const v = this.initialValue();
      if (v?.mappings) {
        Object.entries(v.mappings).forEach(([key, val]) => {
          const ctrl = this.form.controls[key];
          if (ctrl) ctrl.setValue(val ?? null, { emitEvent: false });
        });
      }
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
        this.valueChange.emit(this.getValue());
      });
  }

  getValue(): AccountMappingsValue {
    return { mappings: this.form.getRawValue() };
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  applyDefaults(defaults: Record<string, number | string | null>): void {
    Object.entries(defaults).forEach(([key, val]) => {
      const ctrl = this.form.controls[key];
      if (ctrl) ctrl.setValue(val ?? null);
    });
  }
}
