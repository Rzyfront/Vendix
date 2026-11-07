import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputComponent, MultiSelectorComponent } from '../../../../../../shared/components/index';

export interface FileLimits {
  accept?: string[];
  max_size_mb?: number;
}

const MIME_PRESETS: { value: string; label: string }[] = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/*', label: 'Imágenes (todas)' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
  { value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (.xlsx)' },
  { value: 'text/csv', label: 'CSV' },
];

/** Accepted file types (MIME presets) and max size (1-25 MB) of a file field or upload. */
@Component({
  selector: 'app-file-limits',
  standalone: true,
  imports: [FormsModule, InputComponent, MultiSelectorComponent],
  template: `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <app-multi-selector
        label="Tipos de archivo permitidos"
        placeholder="Cualquier tipo"
        helpText="Si no eliges ninguno se acepta cualquier tipo."
        [options]="options()"
        [ngModel]="accept() ?? []"
        (ngModelChange)="onAccept($event)"
      />
      <app-input
        label="Tamaño máximo (MB)"
        type="number"
        min="1"
        max="25"
        helperText="Entre 1 y 25 MB."
        [ngModel]="maxSize() ?? null"
        (ngModelChange)="onSize($event)"
      />
    </div>
  `,
})
export class FileLimitsComponent {
  readonly accept = input<string[] | undefined>(undefined);
  readonly maxSize = input<number | undefined>(undefined);
  readonly changed = output<FileLimits>();

  readonly options = computed(() => {
    const known = new Set(MIME_PRESETS.map((p) => p.value));
    const extra = (this.accept() ?? [])
      .filter((v) => !known.has(v))
      .map((v) => ({ value: v, label: v }));
    return [...MIME_PRESETS, ...extra];
  });

  onAccept(values: (string | number)[] | null): void {
    const list = (values ?? []).map(String);
    this.changed.emit({
      ...(list.length > 0 ? { accept: list } : {}),
      ...(this.maxSize() !== undefined ? { max_size_mb: this.maxSize() } : {}),
    });
  }

  onSize(raw: unknown): void {
    const parsed = Number(raw);
    const hasSize = raw !== '' && raw !== null && Number.isFinite(parsed) && parsed > 0;
    this.changed.emit({
      ...(this.accept()?.length ? { accept: this.accept() } : {}),
      ...(hasSize ? { max_size_mb: parsed } : {}),
    });
  }
}
