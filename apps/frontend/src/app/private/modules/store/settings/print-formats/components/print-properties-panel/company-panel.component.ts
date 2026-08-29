import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintCompanyBlock,
  PrintCompanyField,
  PrintCompanyFieldKey,
  PrintFormatDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5.6] — Company panel.
 *
 * Edits `definition.companyBlock.fields` — 8 toggles (NIT, DV, regimen,
 * address, phone, email, website, QR) plus a per-field custom_label.
 *
 * The renderer already supports the same 8 keys; this panel guarantees
 * the full set is always present even when the format omits the block.
 */
const COMPANY_FIELDS: ReadonlyArray<{
  key: PrintCompanyFieldKey | 'QR';
  label: string;
}> = [
  { key: 'NIT', label: 'NIT' },
  { key: 'DV', label: 'DV' },
  { key: 'regimen', label: 'Régimen' },
  { key: 'address', label: 'Dirección' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Sitio Web' },
  { key: 'QR', label: 'Código QR' },
];

@Component({
  selector: 'app-print-company-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
        Datos de la Empresa
      </h4>

      <div class="space-y-2">
        @for (entry of fieldEntries(); track entry.key) {
          <div
            class="rounded-lg border border-border p-2"
            [class.bg-surface-secondary]="!entry.field.enabled"
            [class.bg-surface]="entry.field.enabled"
          >
            <label class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-text-primary">
                {{ entry.label }}
              </span>
              <input
                type="checkbox"
                [checked]="entry.field.enabled"
                (change)="toggle(entry.key, $event)"
                class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
              />
            </label>
            @if (entry.field.enabled) {
              <div class="mt-2">
                <label class="block text-[10px] font-medium text-text-secondary mb-0.5">
                  Etiqueta personalizada
                </label>
                <input
                  type="text"
                  [ngModel]="entry.field.customLabel ?? ''"
                  (ngModelChange)="updateLabel(entry.key, $event)"
                  [placeholder]="entry.label"
                  class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-[11px] text-text-primary focus:border-primary-500 focus:outline-none"
                />
              </div>
            }
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.625rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--color-surface, #ffffff);
      }
    `,
  ],
})
export class PrintCompanyPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly block = computed<PrintCompanyBlock>(() => {
    return (
      this.definition().companyBlock ?? { fields: [] as PrintCompanyField[] }
    );
  });

  readonly fieldEntries = computed<
    Array<{ key: PrintCompanyFieldKey | 'QR'; label: string; field: PrintCompanyField }>
  >(() => {
    const fields = this.block().fields ?? [];
    return COMPANY_FIELDS.map((entry) => {
      let field = fields.find((f) => f.key === entry.key) as PrintCompanyField | undefined;
      if (!field) {
        // Synthesize a disabled stub so the UI always shows the full set.
        field = {
          key: entry.key as PrintCompanyFieldKey,
          enabled: false,
        };
      }
      return { ...entry, field };
    });
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  private withField(
    key: PrintCompanyFieldKey | 'QR',
    patch: Partial<PrintCompanyField>,
  ): void {
    const fields = [...this.block().fields];
    const idx = fields.findIndex((f) => f.key === key);
    if (idx >= 0) {
      fields[idx] = { ...fields[idx], ...patch };
    } else {
      fields.push({ key: key as PrintCompanyFieldKey, enabled: true, ...patch });
    }
    this.emit({ ...this.definition(), companyBlock: { fields } });
  }

  toggle(key: PrintCompanyFieldKey | 'QR', event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.withField(key, { enabled });
  }

  updateLabel(key: PrintCompanyFieldKey | 'QR', customLabel: string): void {
    this.withField(key, { customLabel: customLabel || undefined });
  }
}