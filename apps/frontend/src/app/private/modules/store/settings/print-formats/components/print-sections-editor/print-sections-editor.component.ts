import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintSectionDefinition, PrintFieldDefinition } from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-sections-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 class="text-sm font-semibold text-text-primary">Secciones del Documento</h3>
          <p class="text-xs text-text-secondary">Activa, desactiva y reorganiza las partes que componen este formato impreso.</p>
        </div>
      </div>

      <div class="space-y-3">
        @for (section of sections(); track section.id; let idx = $index) {
          <div class="p-3.5 rounded-xl border transition-all duration-200"
               [class.bg-surface]="section.enabled"
               [class.border-primary-500]="section.enabled"
               [class.bg-surface-secondary]="!section.enabled"
               [class.border-border]="!section.enabled"
               [class.opacity-60]="!section.enabled"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 flex-1 min-w-0">
                <button
                  type="button"
                  (click)="moveSection(idx, -1)"
                  [disabled]="idx === 0"
                  class="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition"
                  title="Subir sección"
                >
                  <app-icon name="chevron-up" [size]="14"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="moveSection(idx, 1)"
                  [disabled]="idx === sections().length - 1"
                  class="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-30 disabled:pointer-events-none transition"
                  title="Bajar sección"
                >
                  <app-icon name="chevron-down" [size]="14"></app-icon>
                </button>

                <span class="font-mono text-xs text-text-secondary px-1.5 py-0.5 bg-surface-secondary rounded border border-border">
                  #{{ idx + 1 }}
                </span>

                <div class="flex-1 min-w-0">
                  <div class="text-xs font-semibold text-text-primary truncate">{{ section.title }}</div>
                  <div class="text-[11px] text-text-secondary font-mono">{{ section.type }}</div>
                </div>
              </div>

              <!-- Toggle switch -->
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  [checked]="section.enabled"
                  (change)="toggleSection(section.id, $event)"
                  class="sr-only peer"
                />
                <div class="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>

            <!-- Fields inside section (if available) -->
            @if (section.enabled && section.fields && section.fields.length > 0) {
              <div class="mt-3 pt-3 border-t border-border/60 pl-8 space-y-2">
                <div class="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Campos visibles en esta sección:</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  @for (field of section.fields; track field.id) {
                    <label class="flex items-center gap-2 p-2 rounded-lg bg-surface-secondary/70 border border-border/40 text-xs cursor-pointer hover:bg-surface-hover transition">
                      <input
                        type="checkbox"
                        [checked]="field.enabled"
                        (change)="toggleField(section.id, field.id, $event)"
                        class="rounded border-border text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                      />
                      <span class="text-text-primary">{{ field.label }}</span>
                      <span class="text-[10px] text-text-secondary font-mono ml-auto">{{ field.key }}</span>
                    </label>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class PrintSectionsEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly sections = computed<PrintSectionDefinition[]>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.sections || [];
  });

  toggleSection(sectionId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s) {
        s.enabled = enabled;
      }
      return def;
    });
  }

  toggleField(sectionId: string, fieldId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s && s.fields) {
        const f = s.fields.find((field) => field.id === fieldId);
        if (f) {
          f.enabled = enabled;
        }
      }
      return def;
    });
  }

  moveSection(currentIndex: number, delta: number): void {
    const newIndex = currentIndex + delta;
    this.facade.updateDraftDefinition((def) => {
      if (newIndex < 0 || newIndex >= def.sections.length) return def;
      const temp = def.sections[currentIndex];
      def.sections[currentIndex] = def.sections[newIndex];
      def.sections[newIndex] = temp;
      def.sections.forEach((s, idx) => (s.order = idx + 1));
      return def;
    });
  }
}
