import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintSectionDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5.3] — Section panel.
 *
 * Edits one selected section: title, enabled flag, type, order (display),
 * custom content and CRUD actions (add, remove, duplicate). Type select
 * is locked for fiscal formats where the section is part of the required
 * DIAN layout.
 */
const FISCAL_FORMATS: ReadonlyArray<string> = [
  'fiscal_electronic_invoice',
  'fiscal_credit_note',
];

const SECTION_TYPES: ReadonlyArray<string> = [
  'header',
  'body',
  'items_table',
  'totals',
  'footer',
  'custom_text',
];

@Component({
  selector: 'app-print-section-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      @if (section(); as s) {
        <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
          Sección
        </h4>

        <div class="space-y-3">
          <!-- Title -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">Título</label>
            <input
              type="text"
              [ngModel]="s.title"
              (ngModelChange)="updateTitle($event)"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>

          <!-- Enabled -->
          <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-secondary border border-border">
            <span class="text-xs text-text-primary">Sección activa</span>
            <input
              type="checkbox"
              [checked]="s.enabled"
              (change)="toggleEnabled($event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
          </label>

          <!-- Type -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">Tipo</label>
            <select
              [ngModel]="s.type"
              (ngModelChange)="updateType($event)"
              [disabled]="isFiscalLocked()"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none disabled:opacity-60"
            >
              @for (t of sectionTypes; track t) {
                <option [value]="t">{{ t }}</option>
              }
            </select>
            @if (isFiscalLocked()) {
              <p class="text-[10px] text-amber-500 mt-1">
                Bloqueado: tipo requerido por el formato fiscal.
              </p>
            }
          </div>

          <!-- Order -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Posición (orden)
            </label>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="moveUp()"
                [disabled]="s.order <= 0"
                class="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition"
                title="Subir"
              >
                <app-icon name="chevron-up" [size]="14"></app-icon>
              </button>
              <span class="text-xs font-mono text-text-primary px-2 py-1 bg-surface-secondary rounded border border-border">
                #{{ s.order + 1 }}
              </span>
              <button
                type="button"
                (click)="moveDown()"
                [disabled]="s.order >= maxOrder()"
                class="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition"
                title="Bajar"
              >
                <app-icon name="chevron-down" [size]="14"></app-icon>
              </button>
            </div>
          </div>

          <!-- Custom content -->
          @if (s.type === 'custom_text') {
            <div>
              <label class="block text-[11px] font-medium text-text-secondary mb-1">
                Contenido personalizado
              </label>
              <textarea
                rows="4"
                [ngModel]="s.custom_content ?? ''"
                (ngModelChange)="updateCustomContent($event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none"
                placeholder="path.to.field"
              ></textarea>
            </div>
          }

          <!-- Actions -->
          <div class="pt-2 border-t border-border flex items-center gap-2 flex-wrap">
            <button
              type="button"
              (click)="duplicate()"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-text-primary bg-surface-secondary hover:bg-surface-hover border border-border rounded transition"
              title="Duplicar"
            >
              <app-icon name="copy" [size]="12"></app-icon>
              Duplicar
            </button>
            <button
              type="button"
              (click)="remove()"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-red-500 bg-surface-secondary hover:bg-red-500/10 border border-border rounded transition"
              title="Eliminar"
            >
              <app-icon name="trash-2" [size]="12"></app-icon>
              Eliminar
            </button>

            <div class="ml-auto flex items-center gap-1.5">
              <span class="text-[10px] text-text-tertiary">Añadir:</span>
              <select
                [ngModel]="''"
                (ngModelChange)="addAfter($event)"
                class="px-2 py-1 bg-surface-secondary border border-border rounded text-[11px] text-text-primary focus:border-primary-500 focus:outline-none"
              >
                <option value="" disabled>Seleccionar tipo…</option>
                @for (t of sectionTypes; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </div>
          </div>
        </div>
      } @else {
        <p class="text-xs text-text-tertiary">Sección no encontrada.</p>
      }
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
export class PrintSectionPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly sectionId = input.required<string>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly sectionTypes = SECTION_TYPES;

  readonly section = computed<PrintSectionDefinition | undefined>(() => {
    const def = this.definition();
    return def.sections.find((s) => s.id === this.sectionId());
  });

  readonly maxOrder = computed<number>(() => {
    return Math.max(0, (this.definition().sections?.length ?? 1) - 1);
  });

  readonly isFiscalLocked = computed<boolean>(() => {
    const detail = (this.definition() as any)?.formatType;
    if (detail && FISCAL_FORMATS.includes(detail)) return true;
    return false;
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  updateTitle(title: string): void {
    const id = this.sectionId();
    this.emit({
      ...this.definition(),
      sections: this.definition().sections.map((s) =>
        s.id === id ? { ...s, title } : s,
      ),
    });
  }

  toggleEnabled(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    const id = this.sectionId();
    this.emit({
      ...this.definition(),
      sections: this.definition().sections.map((s) =>
        s.id === id ? { ...s, enabled } : s,
      ),
    });
  }

  updateType(type: string): void {
    if (this.isFiscalLocked()) return;
    const id = this.sectionId();
    this.emit({
      ...this.definition(),
      sections: this.definition().sections.map((s) =>
        s.id === id ? { ...s, type } : s,
      ),
    });
  }

  moveUp(): void {
    const s = this.section();
    if (!s) return;
    const newOrder = Math.max(0, (s.order ?? 0) - 1);
    this.reorder(s.id, newOrder);
  }

  moveDown(): void {
    const s = this.section();
    if (!s) return;
    const newOrder = Math.min(this.maxOrder(), (s.order ?? 0) + 1);
    this.reorder(s.id, newOrder);
  }

  private reorder(targetId: string, newOrder: number): void {
    const sections = [...this.definition().sections];
    const idx = sections.findIndex((s) => s.id === targetId);
    if (idx < 0) return;
    const target = sections[idx];
    const currentOrder = target.order ?? 0;
    sections.forEach((s) => {
      if (s.id === targetId) {
        s.order = newOrder;
      } else if (
        newOrder > currentOrder &&
        (s.order ?? 0) > currentOrder &&
        (s.order ?? 0) <= newOrder
      ) {
        s.order = (s.order ?? 0) - 1;
      } else if (
        newOrder < currentOrder &&
        (s.order ?? 0) >= newOrder &&
        (s.order ?? 0) < currentOrder
      ) {
        s.order = (s.order ?? 0) + 1;
      }
    });
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.emit({ ...this.definition(), sections });
  }

  updateCustomContent(content: string): void {
    const id = this.sectionId();
    this.emit({
      ...this.definition(),
      sections: this.definition().sections.map((s) =>
        s.id === id ? { ...s, custom_content: content } : s,
      ),
    });
  }

  duplicate(): void {
    const s = this.section();
    if (!s) return;
    const id = this.sectionId();
    const sections = [...this.definition().sections];
    const idx = sections.findIndex((sec) => sec.id === id);
    if (idx < 0) return;
    const clone: PrintSectionDefinition = {
      ...s,
      id: `${s.id}_copy_${Date.now()}`,
      title: `${s.title} (copia)`,
    };
    sections.splice(idx + 1, 0, clone);
    sections.forEach((sec, i) => (sec.order = i));
    this.emit({ ...this.definition(), sections });
  }

  remove(): void {
    const id = this.sectionId();
    const sections = this.definition().sections
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i }));
    this.emit({ ...this.definition(), sections });
  }

  addAfter(type: string): void {
    if (!type) return;
    const s = this.section();
    const baseOrder = s ? (s.order ?? 0) + 1 : this.definition().sections.length;
    const sections = [...this.definition().sections];
    const newSection: PrintSectionDefinition = {
      id: `sec_new_${Date.now()}`,
      type,
      title: defaultTitleFor(type),
      enabled: true,
      order: baseOrder,
    };
    sections.push(newSection);
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sections.forEach((sec, i) => (sec.order = i));
    this.emit({ ...this.definition(), sections });
  }
}

function defaultTitleFor(type: string): string {
  switch (type) {
    case 'header':
      return 'Encabezado';
    case 'body':
      return 'Cuerpo';
    case 'items_table':
      return 'Items';
    case 'totals':
      return 'Totales';
    case 'footer':
      return 'Pie';
    case 'custom_text':
      return 'Texto personalizado';
    default:
      return type;
  }
}