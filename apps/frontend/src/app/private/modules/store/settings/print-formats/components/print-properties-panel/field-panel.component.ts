import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintFieldDefinition,
  PrintSectionDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-print-field-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel space-y-3">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Propiedades del Campo
          </h4>
          <span class="text-[11px] font-mono text-primary-500 font-semibold">
            {{ fieldKey() }}
          </span>
        </div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-tertiary font-mono">
          {{ sectionTitle() }}
        </span>
      </div>

      <!-- Visibility Toggle -->
      <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-secondary border border-border cursor-pointer hover:bg-surface-hover transition">
        <div>
          <span class="text-xs font-medium text-text-primary block">Visible en el documento</span>
          <span class="text-[10px] text-text-tertiary block">Mostrar este dato en la impresión</span>
        </div>
        <input
          type="checkbox"
          [checked]="isEnabled()"
          (change)="toggleEnabled($event)"
          class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
        />
      </label>

      <!-- Custom Label -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          Etiqueta Personalizada
        </label>
        <input
          type="text"
          [ngModel]="currentLabel()"
          (ngModelChange)="updateLabel($event)"
          placeholder="Ej: NIT / C.C., Cliente, Teléfono..."
          class="w-full px-2.5 py-1.5 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
        />
      </div>

      <!-- Text Alignment -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          Alineación
        </label>
        <div class="grid grid-cols-4 gap-1">
          @for (pos of positions; track pos.value) {
            <button
              type="button"
              (click)="updatePosition(pos.value)"
              [class.bg-primary-500]="currentPosition() === pos.value"
              [class.text-white]="currentPosition() === pos.value"
              [class.bg-surface-secondary]="currentPosition() !== pos.value"
              [class.text-text-secondary]="currentPosition() !== pos.value"
              class="px-2 py-1.5 text-xs font-medium rounded border border-border hover:bg-surface-hover transition flex items-center justify-center gap-1"
            >
              <app-icon [name]="pos.icon" [size]="12"></app-icon>
              <span>{{ pos.label }}</span>
            </button>
          }
        </div>
      </div>

      <!-- Format Type -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          Formato de Presentación
        </label>
        <select
          [ngModel]="currentFormat()"
          (ngModelChange)="updateFormat($event)"
          class="w-full px-2.5 py-1.5 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
        >
          <option value="text">Texto simple</option>
          <option value="currency">Moneda ($ COP)</option>
          <option value="date">Fecha (DD/MM/AAAA)</option>
          <option value="number">Número</option>
          <option value="percent">Porcentaje (%)</option>
        </select>
      </div>

      <!-- Token / Key path -->
      <div>
        <label class="block text-[11px] font-medium text-text-secondary mb-1">
          Variable / Token Vinculado
        </label>
        <div class="p-2 rounded bg-surface-secondary/70 border border-border/60 text-xs font-mono text-text-primary flex items-center justify-between">
          <span>{{ '{{ ' + fieldKey() + ' }}' }}</span>
          <span class="text-[10px] text-text-tertiary">Lectura</span>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.75rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--color-surface, #ffffff);
      }
    `,
  ],
})
export class PrintFieldPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly fieldIdentifier = input.required<string>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly positions: Array<{ value: 'left' | 'center' | 'right' | 'full'; label: string; icon: string }> = [
    { value: 'left', label: 'Izq', icon: 'align-left' },
    { value: 'center', label: 'Centro', icon: 'align-center' },
    { value: 'right', label: 'Der', icon: 'align-right' },
    { value: 'full', label: 'Ancho', icon: 'maximize' },
  ];

  readonly cleanKey = computed(() => {
    let key = this.fieldIdentifier();
    if (key.startsWith('field-')) key = key.replace('field-', '');
    return key;
  });

  private isFieldMatch(f: PrintFieldDefinition, key: string): boolean {
    if (!f) return false;
    return (
      f.id === key ||
      f.key === key ||
      f.id === `f_${key}` ||
      `f_${f.key}` === key ||
      key.endsWith(f.key) ||
      f.key.endsWith(key)
    );
  }

  readonly matchingSection = computed<PrintSectionDefinition | undefined>(() => {
    const key = this.cleanKey();
    const sections = this.definition().sections || [];
    return sections.find((s) => s.fields?.some((f) => this.isFieldMatch(f, key)));
  });

  readonly matchingField = computed<PrintFieldDefinition | undefined>(() => {
    const s = this.matchingSection();
    const key = this.cleanKey();
    return s?.fields?.find((f) => this.isFieldMatch(f, key));
  });

  readonly sectionTitle = computed(() => this.matchingSection()?.title || 'Sección');
  readonly fieldKey = computed(() => this.matchingField()?.key || this.cleanKey());
  readonly isEnabled = computed(() => this.matchingField()?.enabled ?? true);
  readonly currentLabel = computed(() => this.matchingField()?.custom_label ?? this.matchingField()?.label ?? '');
  readonly currentPosition = computed(() => this.matchingField()?.position ?? 'left');
  readonly currentFormat = computed(() => this.matchingField()?.format ?? 'text');

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  toggleEnabled(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.updateField((f) => ({ ...f, enabled }));
  }

  updateLabel(custom_label: string): void {
    this.updateField((f) => ({ ...f, custom_label }));
  }

  updatePosition(position: 'left' | 'center' | 'right' | 'full'): void {
    this.updateField((f) => ({ ...f, position }));
  }

  updateFormat(format: 'text' | 'number' | 'currency' | 'date' | 'percent'): void {
    this.updateField((f) => ({ ...f, format }));
  }

  private updateField(updater: (f: PrintFieldDefinition) => PrintFieldDefinition): void {
    const sec = this.matchingSection();
    const key = this.cleanKey();
    if (!sec || !sec.fields) return;

    const newSections = (this.definition().sections || []).map((s) => {
      if (s.id !== sec.id) return s;
      const newFields = (s.fields || []).map((f) => {
        if (this.isFieldMatch(f, key)) {
          return updater(f);
        }
        return f;
      });
      return { ...s, fields: newFields };
    });

    this.emit({ ...this.definition(), sections: newSections });
  }
}
