import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import {
  catalogFieldsForSectionType,
  mergeSectionFields,
} from '../../services/section-field-catalog';
import {
  PrintSectionDefinition,
  PrintFieldDefinition,
  PrintFormatDefinition,
} from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-sections-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 class="text-sm font-bold text-text-primary">Estructura & Secciones</h3>
          <p class="text-xs text-text-secondary">
            Personaliza el orden, activa/desactiva secciones y edita cada dato de la factura o ticket.
          </p>
        </div>
      </div>

      <div class="space-y-3">
        @for (section of sections(); track section.id || section.type || idx; let idx = $index) {
          <div
            class="rounded-xl border transition-all duration-200 overflow-hidden shadow-xs"
            [class.bg-surface]="section.enabled"
            [class.border-border]="section.enabled && !isExpanded(section.id)"
            [class.border-primary-500]="section.enabled && isExpanded(section.id)"
            [class.bg-surface-secondary]="!section.enabled"
            [class.border-border]="!section.enabled"
            [class.opacity-60]="!section.enabled"
          >
            <!-- Section Header Row -->
            <div class="p-3 flex items-center justify-between gap-2.5 bg-surface-secondary/40">
              <!-- Left controls & title -->
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <!-- Move buttons -->
                <div class="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    (click)="moveSection(idx, -1)"
                    [disabled]="idx === 0"
                    class="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer"
                    title="Subir sección"
                  >
                    <app-icon name="chevron-up" [size]="12"></app-icon>
                  </button>
                  <button
                    type="button"
                    (click)="moveSection(idx, 1)"
                    [disabled]="idx === sections().length - 1"
                    class="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-20 disabled:pointer-events-none transition cursor-pointer"
                    title="Bajar sección"
                  >
                    <app-icon name="chevron-down" [size]="12"></app-icon>
                  </button>
                </div>

                <span class="font-mono text-[10px] text-text-tertiary px-1.5 py-0.5 bg-surface rounded border border-border shrink-0">
                  #{{ idx + 1 }}
                </span>

                <!-- Clickable Title & Expand -->
                <button
                  type="button"
                  (click)="toggleExpand(section.id)"
                  class="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer group"
                >
                  <app-icon
                    [name]="isExpanded(section.id) ? 'chevron-down' : 'chevron-right'"
                    [size]="14"
                    class="text-text-tertiary group-hover:text-primary-500 transition"
                  ></app-icon>
                  <div class="min-w-0">
                    <span class="text-xs font-bold text-text-primary block truncate group-hover:text-primary-500 transition">
                      {{ section.title || sectionName(section.type) }}
                    </span>
                    <span class="text-[10px] text-text-tertiary font-mono block truncate">
                      {{ section.type }}
                    </span>
                  </div>
                </button>
              </div>

              <!-- Toggle switch -->
              <label class="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  [checked]="section.enabled"
                  (change)="toggleSection(section.id, $event)"
                  class="sr-only peer"
                />
                <div class="w-8 h-4 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary-600"></div>
              </label>
            </div>

            <!-- Expanded Section Editor (Fields & Properties) -->
            @if (section.enabled && isExpanded(section.id)) {
              <div class="p-3.5 border-t border-border bg-surface space-y-3 animate-fade-in">
                <!-- Section Title Edit -->
                <div>
                  <label class="block text-[11px] font-medium text-text-secondary mb-1">
                    Título de la Sección
                  </label>
                  <input
                    type="text"
                    [ngModel]="section.title"
                    (ngModelChange)="updateSectionTitle(section.id, $event)"
                    placeholder="Título visible"
                    class="w-full px-2.5 py-1.5 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <!-- Fields list -->
                @if (section.fields && section.fields.length > 0) {
                  <div class="space-y-2 pt-2 border-t border-border/60">
                    <span class="text-[10px] font-bold text-text-tertiary uppercase tracking-wider block">
                      Campos y Datos de esta Sección:
                    </span>

                    <div class="space-y-2">
                      @for (field of section.fields; track field.id || field.key || f_idx; let f_idx = $index) {
                        <div class="p-2.5 rounded-lg border border-border bg-surface-secondary/40 space-y-2">
                          <!-- Field top bar -->
                          <div class="flex items-center justify-between gap-2">
                            <label class="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                [checked]="field.enabled !== false"
                                (change)="toggleField(section.id, field.id, $event)"
                                class="rounded border-border text-primary-600 focus:ring-primary-500 w-3.5 h-3.5 cursor-pointer"
                              />
                              <span class="text-xs font-semibold text-text-primary">
                                {{ field.label || field.key }}
                              </span>
                            </label>

                            <span class="text-[10px] font-mono text-primary-500 bg-primary-500/10 px-1.5 py-0.5 rounded">
                              {{ '{{ ' + field.key + ' }}' }}
                            </span>
                          </div>

                          @if (field.enabled !== false) {
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              <!-- Custom Label Input -->
                              <div>
                                <label class="block text-[10px] font-medium text-text-secondary mb-0.5">
                                  Texto / Etiqueta
                                </label>
                                <input
                                  type="text"
                                  [ngModel]="field.custom_label ?? field.label"
                                  (ngModelChange)="updateFieldLabel(section.id, field.id, $event)"
                                  [placeholder]="field.label || 'Etiqueta'"
                                  class="w-full px-2 py-1 bg-surface border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
                                />
                              </div>

                              <!-- Format Selector -->
                              <div>
                                <label class="block text-[10px] font-medium text-text-secondary mb-0.5">
                                  Formato
                                </label>
                                <select
                                  [ngModel]="field.format ?? 'text'"
                                  (ngModelChange)="updateFieldFormat(section.id, field.id, $event)"
                                  class="w-full px-2 py-1 bg-surface border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
                                >
                                  <option value="text">Texto</option>
                                  <option value="currency">Moneda ($ COP)</option>
                                  <option value="date">Fecha (DD/MM/AAAA)</option>
                                  <option value="number">Número</option>
                                  <option value="percent">Porcentaje (%)</option>
                                </select>
                              </div>
                            </div>

                            <!-- Alignment Buttons -->
                            <div>
                              <label class="block text-[10px] font-medium text-text-secondary mb-0.5">
                                Alineación
                              </label>
                              <div class="grid grid-cols-4 gap-1">
                                @for (pos of alignOptions; track pos.value) {
                                  <button
                                    type="button"
                                    (click)="updateFieldAlign(section.id, field.id, pos.value)"
                                    [class.bg-primary-500]="(field.position || 'left') === pos.value"
                                    [class.text-white]="(field.position || 'left') === pos.value"
                                    [class.bg-surface]="(field.position || 'left') !== pos.value"
                                    [class.text-text-secondary]="(field.position || 'left') !== pos.value"
                                    class="py-1 text-[11px] font-medium rounded border border-border hover:bg-surface-hover transition flex items-center justify-center gap-1 cursor-pointer"
                                  >
                                    <app-icon [name]="pos.icon" [size]="11"></app-icon>
                                    <span>{{ pos.label }}</span>
                                  </button>
                                }
                              </div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
                @if (availableFields(section).length > 0) {
                  <div class="space-y-2 pt-2">
                    <span class="text-[10px] font-bold text-text-tertiary uppercase tracking-wider block">
                      Agregar dato disponible:
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      @for (opt of availableFields(section); track opt.id) {
                        <button
                          type="button"
                          (click)="addField(section.id, opt.id)"
                          class="px-2 py-1 text-[11px] font-medium rounded-full border border-dashed border-border text-text-secondary hover:text-primary-500 hover:border-primary-500 transition cursor-pointer"
                          [title]="opt.key"
                        >
                          + {{ opt.label }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PrintSectionsEditorComponent {
  readonly facade = inject(PrintFormatsFacade);
  readonly expandedSections = signal<Set<string>>(new Set(['sec_header', 'header', 'sec_doc_info', 'document_info']));

  readonly alignOptions: Array<{ value: 'left' | 'center' | 'right' | 'full'; label: string; icon: string }> = [
    { value: 'left', label: 'Izq', icon: 'align-left' },
    { value: 'center', label: 'Centro', icon: 'align-center' },
    { value: 'right', label: 'Der', icon: 'align-right' },
    { value: 'full', label: 'Ancho', icon: 'maximize' },
  ];

  readonly sections = computed<PrintSectionDefinition[]>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.sections || [];
  });

  isExpanded(sectionId: string): boolean {
    return this.expandedSections().has(sectionId);
  }

  toggleExpand(sectionId: string): void {
    this.expandedSections.update((set) => {
      const next = new Set(set);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  sectionName(type: string): string {
    switch (type) {
      case 'header':
      case 'fiscal_header':
        return 'Cabecera & Datos de Tienda';
      case 'document_info':
      case 'doc_info':
        return 'Información del Documento';
      case 'customer_info':
      case 'fiscal_buyer_info':
        return 'Datos del Cliente / Adquirente';
      case 'items_table':
      case 'kitchen_items':
        return 'Tabla de Productos / Servicios';
      case 'totals_summary':
      case 'totals':
        return 'Totales & Desglose de Pago';
      case 'taxes_breakdown':
      case 'fiscal_tax_breakdown':
        return 'Discriminación de Impuestos';
      case 'fiscal_cufe_box':
      case 'cufe_box':
        return 'Código Criptográfico CUFE / CUDE';
      case 'fiscal_qr_section':
      case 'qr_code':
        return 'Código QR Validación DIAN';
      case 'footer':
        return 'Pie de Página & Mensaje Legal';
      default:
        return type;
    }
  }

  toggleSection(sectionId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s) s.enabled = enabled;
      return def;
    });
  }

  updateSectionTitle(sectionId: string, title: string): void {
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s) s.title = title;
      return def;
    });
  }

  toggleField(sectionId: string, fieldId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s && s.fields) {
        const f = s.fields.find((field) => field.id === fieldId || field.key === fieldId);
        if (f) f.enabled = enabled;
      }
      return def;
    });
  }

  updateFieldLabel(sectionId: string, fieldId: string, custom_label: string): void {
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s && s.fields) {
        const f = s.fields.find((field) => field.id === fieldId || field.key === fieldId);
        if (f) f.custom_label = custom_label;
      }
      return def;
    });
  }

  updateFieldFormat(sectionId: string, fieldId: string, format: 'text' | 'currency' | 'date' | 'number' | 'percent'): void {
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s && s.fields) {
        const f = s.fields.find((field) => field.id === fieldId || field.key === fieldId);
        if (f) f.format = format;
      }
      return def;
    });
  }

  updateFieldAlign(sectionId: string, fieldId: string, position: 'left' | 'center' | 'right' | 'full'): void {
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (s && s.fields) {
        const f = s.fields.find((field) => field.id === fieldId || field.key === fieldId);
        if (f) f.position = position;
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

  availableFields(section: PrintSectionDefinition): Array<{ id: string; key: string; label: string }> {
    return mergeSectionFields(section.fields as any, section.type);
  }

  addField(sectionId: string, catalogId: string): void {
    const draft = this.facade.draftDefinition();
    const sec = draft?.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const opt = catalogFieldsForSectionType(sec.type).find((c) => c.id === catalogId);
    if (!opt) return;
    this.facade.updateDraftDefinition((def) => {
      const s = def.sections.find((item) => item.id === sectionId);
      if (!s) return def;
      s.fields = s.fields ?? [];
      if (s.fields.some((f) => f.id === opt.id)) return def;
      s.fields.push({
        id: opt.id,
        key: opt.key,
        label: opt.label,
        enabled: true,
        position: (opt.position ?? 'left') as any,
        format: (opt.format ?? 'text') as any,
      } as any);
      return def;
    });
  }
}
