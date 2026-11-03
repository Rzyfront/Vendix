import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { VariableBarcodeFormat } from '../../../../../../core/models/store-settings.interface';
import {
  VARIABLE_BARCODE_PRESETS,
  VARIABLE_BARCODE_REASON_LABELS,
  createFormatFromPreset,
  resolveVariableBarcode,
} from '../../../../../../shared/utils/variable-barcode.util';

const MAX_FORMATS = 10;
const MAX_PREFIXES = 20;

/**
 * Editor de formatos de etiqueta de balanza (códigos de barras de peso
 * variable). Trabaja sobre una copia y solo emite `save` al confirmar.
 */
@Component({
  selector: 'app-variable-barcode-formats-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      size="lg"
      [dialog]="true"
      title="Formatos de etiqueta de balanza"
      subtitle="Cómo leer el código de barras que imprime tu balanza etiquetadora"
    >
      <div class="p-2 md:p-4 space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-[var(--color-text-secondary)]">Agregar desde plantilla:</span>
          @for (preset of presets; track preset.preset) {
            <app-button
              variant="outline"
              size="sm"
              [disabled]="draft().length >= maxFormats"
              (clicked)="addFromPreset(preset.preset)"
            >
              {{ preset.label }}
            </app-button>
          }
        </div>

        @if (draft().length === 0) {
          <p class="text-sm text-[var(--color-text-muted)]">
            Aún no hay formatos. Agrega uno desde una plantilla.
          </p>
        }

        @for (f of draft(); track f.id; let i = $index) {
          <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="f.enabled"
                  (change)="patch(f.id, { enabled: $any($event.target).checked })"
                />
                Activo
              </label>
              <app-button variant="outline" size="sm" (clicked)="remove(f.id)">
                Eliminar
              </app-button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <app-input
                label="Nombre"
                [ngModel]="f.name"
                (ngModelChange)="patch(f.id, { name: $event })"
              ></app-input>
              <app-input
                label="Prefijos (separados por coma)"
                [ngModel]="prefixText()[f.id] ?? ''"
                (ngModelChange)="setPrefixes(f, $event)"
                [helperText]="'Largo de cada prefijo: ' + f.prefix_length + ' dígito(s)'"
              ></app-input>
              <app-input
                label="Peso máximo (kg)"
                type="number"
                [ngModel]="f.max_weight_kg ?? null"
                (ngModelChange)="setMaxWeight(f.id, $event)"
                helperText="Opcional"
              ></app-input>
            </div>

            <p class="text-xs text-[var(--color-text-muted)]">
              Código en posiciones {{ f.product_code_start }}–{{ f.product_code_start + f.product_code_length - 1 }},
              peso en {{ f.value_start }}–{{ f.value_start + f.value_length - 1 }}
              ({{ f.value_unit === 'g' ? 'gramos' : 'kg' }}, {{ f.value_decimals }} decimales).
            </p>
          </div>
        }

        <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
          <app-input
            label="Probador"
            placeholder="Escanea o pega un código de 13 dígitos"
            [ngModel]="testCode()"
            (ngModelChange)="testCode.set(('' + ($event ?? '')).trim())"
            helperText="Prueba el código con los formatos activos de arriba"
          ></app-input>
          @if (testResult(); as r) {
            @if (r.ok) {
              <p class="text-sm font-medium text-[var(--color-success-700)]">
                Producto código {{ r.productCode }} · {{ r.weightText }} kg (formato {{ r.formatName }})
              </p>
            } @else {
              <p class="text-sm font-medium text-[var(--color-error)]">{{ r.reasonText }}</p>
            }
          }
        </div>
      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-border">
          <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
          <app-button variant="primary" (clicked)="onSave()">Guardar formatos</app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class VariableBarcodeFormatsModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly formats = input<VariableBarcodeFormat[]>([]);
  readonly save = output<VariableBarcodeFormat[]>();

  readonly presets = VARIABLE_BARCODE_PRESETS;
  readonly maxFormats = MAX_FORMATS;

  readonly draft = signal<VariableBarcodeFormat[]>([]);
  readonly prefixText = signal<Record<string, string>>({});
  readonly testCode = signal('');

  readonly testResult = computed<
    | { ok: true; productCode: number; weightText: string; formatName: string }
    | { ok: false; reasonText: string }
    | null
  >(() => {
    const code = this.testCode();
    if (!code) return null;
    const formats = this.draft();
    const r = resolveVariableBarcode(code, formats);
    if (!r.ok) {
      return { ok: false, reasonText: VARIABLE_BARCODE_REASON_LABELS[r.reason] };
    }
    return {
      ok: true,
      productCode: r.productCode,
      weightText: r.weightKg.toLocaleString('es-CO', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
      formatName: formats.find((f) => f.id === r.format_id)?.name ?? '',
    };
  });

  constructor() {
    // Al abrir se parte de una copia de los formatos guardados.
    effect(() => {
      if (!this.isOpen()) return;
      const current = this.formats();
      untracked(() => {
        const copy = (current ?? []).map((f) => ({ ...f, prefixes: [...f.prefixes] }));
        this.draft.set(copy);
        this.prefixText.set(
          Object.fromEntries(copy.map((f) => [f.id, f.prefixes.join(', ')])),
        );
        this.testCode.set('');
      });
    });
  }

  addFromPreset(preset: (typeof VARIABLE_BARCODE_PRESETS)[number]['preset']): void {
    if (this.draft().length >= MAX_FORMATS) return;
    const created = createFormatFromPreset(preset);
    this.draft.update((list) => [...list, created]);
    this.prefixText.update((m) => ({ ...m, [created.id]: created.prefixes.join(', ') }));
  }

  remove(id: string): void {
    this.draft.update((list) => list.filter((f) => f.id !== id));
  }

  patch(id: string, changes: Partial<VariableBarcodeFormat>): void {
    this.draft.update((list) =>
      list.map((f) => (f.id === id ? { ...f, ...changes } : f)),
    );
  }

  setPrefixes(format: VariableBarcodeFormat, raw: string | null): void {
    const text = raw ?? '';
    this.prefixText.update((m) => ({ ...m, [format.id]: text }));
    const prefixes = [
      ...new Set(
        text
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    ]
      .filter((p) => new RegExp(`^\\d{${format.prefix_length}}$`).test(p))
      .slice(0, MAX_PREFIXES);
    this.patch(format.id, { prefixes });
  }

  setMaxWeight(id: string, raw: unknown): void {
    const n = raw === null || raw === '' || raw === undefined ? NaN : Number(raw);
    if (Number.isFinite(n) && n > 0) {
      this.patch(id, { max_weight_kg: n });
    } else {
      this.draft.update((list) =>
        list.map((f) => {
          if (f.id !== id) return f;
          const { max_weight_kg: _omit, ...rest } = f;
          return rest;
        }),
      );
    }
  }

  onSave(): void {
    this.save.emit(
      this.draft().map((f) => ({
        ...f,
        // El backend exige nombre: uno vacío vuelve al genérico.
        name: f.name?.trim() || 'Formato de balanza',
        prefixes: [...f.prefixes],
      })),
    );
    this.isOpen.set(false);
  }
}
