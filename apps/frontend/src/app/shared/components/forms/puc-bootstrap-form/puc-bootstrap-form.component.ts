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
} from '@angular/forms';
import { IconComponent } from '../../icon/icon.component';

export type PucSource = 'default' | 'csv';

export interface PucAccountRow {
  code: string;
  name: string;
  account_type?: string;
  parent_code?: string;
}

export interface PucBootstrapValue {
  source: PucSource;
  rows: PucAccountRow[];
}

interface PucControls {
  source: FormControl<PucSource>;
}

@Component({
  selector: 'app-puc-bootstrap-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-text-primary mb-2">
          Origen del Plan Único de Cuentas (PUC)
        </legend>

        <label
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
          [class.border-primary]="form.value.source === 'default'"
          [class.bg-primary]="form.value.source === 'default'"
          [class.bg-opacity-5]="form.value.source === 'default'"
          [class.border-border]="form.value.source !== 'default'"
        >
          <input
            type="radio"
            value="default"
            formControlName="source"
            class="mt-1"
          />
          <div>
            <div class="text-sm font-medium text-text-primary">
              Usar plantilla colombiana (PUC estándar)
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              Carga el catálogo de cuentas según el Plan Único de Cuentas
              colombiano para comerciantes. Recomendado.
            </div>
          </div>
        </label>

        <label
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
          [class.border-primary]="form.value.source === 'csv'"
          [class.bg-primary]="form.value.source === 'csv'"
          [class.bg-opacity-5]="form.value.source === 'csv'"
          [class.border-border]="form.value.source !== 'csv'"
        >
          <input
            type="radio"
            value="csv"
            formControlName="source"
            class="mt-1"
          />
          <div class="flex-1">
            <div class="text-sm font-medium text-text-primary">
              Subir CSV personalizado
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              Cargue su propio catálogo de cuentas en formato CSV
              (columnas: code, name, account_type, parent_code).
            </div>
          </div>
        </label>
      </fieldset>

      @if (form.value.source === 'csv') {
        <div class="space-y-3">
          <div
            class="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
            (click)="fileInput.click()"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event)"
          >
            <app-icon
              name="upload-cloud"
              [size]="28"
              class="text-gray-400 mx-auto mb-2"
            ></app-icon>
            <p class="text-sm text-text-secondary">
              {{ csvFileName() || 'Haga clic o arrastre el archivo .csv aquí' }}
            </p>
            @if (!csvFileName()) {
              <p class="text-xs text-gray-400 mt-1">
                Encabezados: code, name, account_type, parent_code
              </p>
            }
          </div>
          <input
            #fileInput
            type="file"
            accept=".csv"
            (change)="onFileSelected($event)"
            class="hidden"
          />

          @if (parseError()) {
            <p class="text-xs text-[var(--color-destructive)]">
              {{ parseError() }}
            </p>
          }

          @if (parsedRows().length > 0) {
            <div class="text-xs text-emerald-600">
              {{ parsedRows().length }} cuentas detectadas en el CSV
            </div>
            <div class="border border-border rounded-lg overflow-hidden">
              <table class="w-full text-xs">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1.5 font-medium">Código</th>
                    <th class="text-left px-2 py-1.5 font-medium">Nombre</th>
                    <th class="text-left px-2 py-1.5 font-medium">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of previewRows(); track row.code) {
                    <tr class="border-t border-border">
                      <td class="px-2 py-1 font-mono">{{ row.code }}</td>
                      <td class="px-2 py-1">{{ row.name }}</td>
                      <td class="px-2 py-1 text-text-secondary">
                        {{ row.account_type || '-' }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </form>
  `,
})
export class PucBootstrapFormComponent {
  readonly initialValue = input<Partial<PucBootstrapValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<PucBootstrapValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(true);
  readonly parsedRows = signal<PucAccountRow[]>([]);
  readonly csvFileName = signal<string>('');
  readonly parseError = signal<string>('');

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<PucControls> = new FormGroup<PucControls>({
    source: new FormControl<PucSource>('default', { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue({ source: v.source ?? 'default' }, { emitEvent: false });
        if (v.rows) this.parsedRows.set(v.rows);
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emit());
  }

  previewRows(): PucAccountRow[] {
    return this.parsedRows().slice(0, 10);
  }

  getValue(): PucBootstrapValue {
    return {
      source: this.form.controls.source.value,
      rows: this.parsedRows(),
    };
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── CSV handling ──────────────────────────────────────────
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.readCsv(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (file && file.name.endsWith('.csv')) this.readCsv(file);
  }

  private readCsv(file: File): void {
    this.csvFileName.set(file.name);
    this.parseError.set('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const rows = this.parseCsv(text);
        if (rows.length === 0) {
          this.parseError.set('El archivo CSV no contiene cuentas válidas.');
          this.parsedRows.set([]);
          this.valid.set(false);
        } else {
          this.parsedRows.set(rows);
          this.valid.set(true);
        }
        this.emit();
      } catch (err) {
        this.parseError.set('No se pudo leer el archivo CSV.');
        this.parsedRows.set([]);
        this.valid.set(false);
        this.emit();
      }
    };
    reader.readAsText(file);
  }

  private parseCsv(text: string): PucAccountRow[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idxCode = header.indexOf('code');
    const idxName = header.indexOf('name');
    const idxType = header.indexOf('account_type');
    const idxParent = header.indexOf('parent_code');
    if (idxCode < 0 || idxName < 0) return [];

    const rows: PucAccountRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      const code = cells[idxCode];
      const name = cells[idxName];
      if (!code || !name) continue;
      rows.push({
        code,
        name,
        account_type: idxType >= 0 ? cells[idxType] || undefined : undefined,
        parent_code: idxParent >= 0 ? cells[idxParent] || undefined : undefined,
      });
    }
    return rows;
  }

  private emit(): void {
    const isCsv = this.form.controls.source.value === 'csv';
    const isValid = !isCsv || this.parsedRows().length > 0;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.getValue());
  }
}
