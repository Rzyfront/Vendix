import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import { MetadataField } from '../../interfaces/metadata-field.interface';
import { DataCollectionTemplate } from '../../interfaces/data-collection-template.interface';

interface ItemForm {
  metadata_field_id: number;
  sort_order: number;
  is_required: boolean;
  include_in_summary: boolean;
  width: string;
  icon: string;
}

interface SectionForm {
  title: string;
  description: string;
  icon: string;
  sort_order: number;
  items: ItemForm[];
  child_sections: SectionForm[];
}

interface TabForm {
  title: string;
  icon: string;
  sort_order: number;
  sections: SectionForm[];
}

@Component({
  selector: 'app-template-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, IconPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background: rgba(0,0,0,0.5)"
      (click)="close.emit()"
    >
      <div
        class="w-full max-w-2xl rounded-xl shadow-xl"
        style="background: var(--color-surface)"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between px-6 py-4"
          style="border-bottom: 1px solid var(--color-border)"
        >
          <h3 class="font-bold text-base" style="color: var(--color-text)">
            {{ template() ? 'Editar Plantilla' : 'Nueva Plantilla' }}
          </h3>
          <div class="flex items-center gap-2">
            @if (template(); as t) {
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style="color: var(--color-primary); border: 1px solid var(--color-primary)"
                (click)="openAdvancedEditor(t.id)"
              >
                <app-icon name="settings-2" [size]="14"></app-icon>
                Editor Avanzado
              </button>
            }
            <button
              class="p-1 rounded-lg"
              style="color: var(--color-text-muted)"
              (click)="close.emit()"
            >
              <app-icon name="x" [size]="18"></app-icon>
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <!-- Name + Icon -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              style="color: var(--color-text)"
              >Nombre *</label
            >
            <div class="flex items-center gap-2">
              <app-icon-picker
                [value]="formData.icon"
                (valueChange)="formData.icon = $event"
                placeholder="Icono plantilla"
              />
              <input
                type="text"
                class="flex-1 px-3 py-2 border rounded-lg text-sm"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                [(ngModel)]="formData.name"
                placeholder="Ej: Ficha de cliente"
              />
            </div>
          </div>

          <!-- Description -->
          <div>
            <label
              class="block text-sm font-medium mb-1"
              style="color: var(--color-text)"
              >Descripcion</label
            >
            <textarea
              class="w-full px-3 py-2 border rounded-lg text-sm resize-none"
              rows="2"
              style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
              [(ngModel)]="formData.description"
              placeholder="Descripcion opcional de la plantilla"
            ></textarea>
          </div>

          <!-- Entity Type + Status -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label
                class="block text-sm font-medium mb-1"
                style="color: var(--color-text)"
                >Tipo de Entidad *</label
              >
              <select
                class="w-full px-3 py-2 border rounded-lg text-sm"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                [(ngModel)]="formData.entity_type"
              >
                <option value="customer">Cliente</option>
                <option value="booking">Reserva</option>
                <option value="order">Orden</option>
              </select>
            </div>
            <div>
              <label
                class="block text-sm font-medium mb-1"
                style="color: var(--color-text)"
                >Estado *</label
              >
              <select
                class="w-full px-3 py-2 border rounded-lg text-sm"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                [(ngModel)]="formData.status"
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="archived">Archivado</option>
              </select>
            </div>
          </div>

          <!-- Is Default -->
          <div class="flex items-center">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="w-4 h-4 rounded"
                [(ngModel)]="formData.is_default"
              />
              <span class="text-sm" style="color: var(--color-text)"
                >Plantilla por defecto</span
              >
            </label>
          </div>

          <!-- Use Tabs Toggle -->
          <div class="flex items-center">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                class="w-4 h-4 rounded"
                [(ngModel)]="formData.use_tabs"
              />
              <span class="text-sm" style="color: var(--color-text)"
                >Organizar con pestanas</span
              >
            </label>
          </div>

          <!-- Productos Vinculados -->
          @if (availableProducts().length > 0) {
            <div>
              <label
                class="block text-sm font-medium mb-1"
                style="color: var(--color-text)"
                >Productos Vinculados</label
              >
              <p class="text-xs mb-2" style="color: var(--color-text-muted)">
                Los servicios vinculados generaran formularios automaticamente
                al reservar
              </p>

              @if (selectedProductIds.length > 0) {
                <div class="flex flex-wrap gap-2 mb-2">
                  @for (pid of selectedProductIds; track pid) {
                    <div
                      class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                      style="background: var(--color-surface-secondary); color: var(--color-text)"
                    >
                      <span class="font-medium">{{ getProductName(pid) }}</span>
                      <button
                        class="p-0.5 rounded-full"
                        style="color: var(--color-text-muted)"
                        (click)="removeProduct(pid)"
                      >
                        <app-icon name="x" [size]="12"></app-icon>
                      </button>
                    </div>
                  }
                </div>
              }

              <select
                class="w-full px-2 py-1.5 border rounded-lg text-xs"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                (change)="onProductSelect($event)"
              >
                <option value="">+ Vincular producto...</option>
                @for (product of getUnselectedProducts(); track product.id) {
                  <option [value]="product.id">{{ product.name }}</option>
                }
              </select>
            </div>
          }

          <!-- Divider + Sections/Tabs -->
          <div style="border-top: 1px solid var(--color-border)" class="pt-4">
            <!-- Tab bar (when use_tabs is enabled) -->
            @if (formData.use_tabs) {
              <div class="mb-3">
                <div
                  class="flex items-center gap-1 overflow-x-auto pb-2"
                  style="border-bottom: 1px solid var(--color-border)"
                >
                  @for (tab of formData.tabs; track $index; let ti = $index) {
                    <div
                      class="flex items-center gap-1 px-3 py-1.5 cursor-pointer text-sm whitespace-nowrap shrink-0 rounded-t-lg"
                      [style.border-bottom]="
                        activeTabIndex === ti
                          ? '2px solid var(--color-primary)'
                          : '2px solid transparent'
                      "
                      [style.color]="
                        activeTabIndex === ti
                          ? 'var(--color-primary)'
                          : 'var(--color-text-muted)'
                      "
                      (click)="activeTabIndex = ti"
                    >
                      <input
                        type="text"
                        class="bg-transparent border-none outline-none text-sm font-medium w-24"
                        [style.color]="
                          activeTabIndex === ti
                            ? 'var(--color-primary)'
                            : 'var(--color-text-muted)'
                        "
                        [(ngModel)]="tab.title"
                        placeholder="Pestana..."
                        (click)="$event.stopPropagation(); activeTabIndex = ti"
                      />
                      <button
                        class="p-0.5 rounded-full shrink-0"
                        style="color: var(--color-text-muted)"
                        (click)="$event.stopPropagation(); removeTab(ti)"
                      >
                        <app-icon name="x" [size]="12"></app-icon>
                      </button>
                    </div>
                  }
                  <button
                    class="flex items-center gap-1 px-2 py-1.5 text-xs font-medium shrink-0 rounded-lg"
                    style="color: var(--color-primary)"
                    (click)="addTab()"
                  >
                    <app-icon name="plus" [size]="14"></app-icon>
                    Pestana
                  </button>
                </div>

                <!-- Tab icon picker -->
                @if (formData.tabs[activeTabIndex]) {
                  <div class="flex items-center gap-2 mt-2">
                    <label
                      class="text-xs shrink-0"
                      style="color: var(--color-text-muted)"
                      >Icono:</label
                    >
                    <app-icon-picker
                      [value]="formData.tabs[activeTabIndex].icon"
                      (valueChange)="formData.tabs[activeTabIndex].icon = $event"
                      placeholder="Icono tab"
                    />
                  </div>
                }
              </div>
            }

            <!-- Section header -->
            <div class="flex items-center justify-between mb-3">
              <h4
                class="text-sm font-semibold"
                style="color: var(--color-text)"
              >
                {{
                  formData.use_tabs && formData.tabs.length
                    ? 'Secciones de pestana'
                    : 'Secciones'
                }}
              </h4>
              <button
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
                style="color: var(--color-primary); border: 1px solid var(--color-primary)"
                (click)="addSection()"
              >
                <app-icon name="plus" [size]="14"></app-icon>
                Agregar Seccion
              </button>
            </div>

            <!-- Empty state -->
            @if (activeSections.length === 0) {
              <div
                class="text-center py-6 border rounded-lg border-dashed"
                style="border-color: var(--color-border)"
              >
                <app-icon
                  name="layers"
                  [size]="24"
                  color="var(--color-text-muted)"
                ></app-icon>
                <p class="text-xs mt-1" style="color: var(--color-text-muted)">
                  {{
                    formData.use_tabs && !formData.tabs.length
                      ? 'Agrega una pestana primero.'
                      : 'No hay secciones. Agrega una para organizar los campos.'
                  }}
                </p>
              </div>
            }

            <!-- Section cards -->
            @for (section of activeSections; track $index; let si = $index) {
              <ng-container
                *ngTemplateOutlet="
                  sectionCard;
                  context: {
                    $implicit: section,
                    si: si,
                    isChild: false,
                    parentIndex: -1,
                  }
                "
              ></ng-container>
            }
          </div>
        </div>

        <!-- Footer -->
        <div
          class="flex justify-end gap-2 px-6 py-4"
          style="border-top: 1px solid var(--color-border)"
        >
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium"
            style="color: var(--color-text); border: 1px solid var(--color-border)"
            (click)="close.emit()"
          >
            Cancelar
          </button>
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style="background: var(--color-primary)"
            [disabled]="!formData.name"
            [style.opacity]="!formData.name ? '0.5' : '1'"
            (click)="onSave()"
          >
            {{ template() ? 'Guardar' : 'Crear' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Section Card Template (reusable for parent & child sections) -->
    <ng-template
      #sectionCard
      let-section
      let-si="si"
      let-isChild="isChild"
      let-parentIndex="parentIndex"
    >
      <div
        class="border rounded-lg mb-3 overflow-hidden"
        [class.ml-4]="isChild"
        [style.border-color]="
          isChild
            ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)'
            : 'var(--color-border)'
        "
        [style.border-left]="
          isChild
            ? '2px solid color-mix(in srgb, var(--color-primary) 20%, transparent)'
            : ''
        "
      >
        <!-- Section Header -->
        <div
          class="flex items-center gap-2 px-3 py-2"
          style="background: var(--color-surface-secondary)"
        >
          <app-icon
            name="grip-vertical"
            [size]="14"
            color="var(--color-text-muted)"
          ></app-icon>
          <input
            type="text"
            class="flex-1 px-2 py-1 border rounded text-sm"
            style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
            [(ngModel)]="section.title"
            placeholder="Nombre de la seccion"
          />
          <app-icon-picker
            [value]="section.icon"
            (valueChange)="section.icon = $event"
            placeholder="Icono"
            [alignRight]="true"
          />
          <button
            class="p-1 rounded-lg transition-colors"
            style="color: #ef4444"
            (click)="
              isChild ? removeChildSection(parentIndex, si) : removeSection(si)
            "
          >
            <app-icon name="trash-2" [size]="14"></app-icon>
          </button>
        </div>

        <!-- Section Body -->
        <div class="px-3 py-2 space-y-2">
          <!-- Fields in section -->
          @if (section.items.length > 0) {
            <div class="space-y-1.5">
              @for (item of section.items; track $index; let fi = $index) {
                <div
                  class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs flex-wrap"
                  style="background: var(--color-surface-secondary); color: var(--color-text)"
                >
                  <span class="opacity-50">{{
                    getFieldType(item.metadata_field_id)
                  }}</span>
                  <span class="font-medium flex-1">{{
                    getFieldLabel(item.metadata_field_id)
                  }}</span>
                  <label
                    class="flex items-center gap-1 text-xs cursor-pointer"
                    style="color: var(--color-text-muted)"
                  >
                    <input
                      type="checkbox"
                      class="w-3 h-3 rounded"
                      [(ngModel)]="item.is_required"
                    />
                    Requerido
                  </label>
                  <label
                    class="flex items-center gap-1 text-xs cursor-pointer"
                    style="color: var(--color-text-muted)"
                  >
                    <input
                      type="checkbox"
                      class="w-3 h-3 rounded"
                      [(ngModel)]="item.include_in_summary"
                    />
                    En resumen
                  </label>
                  <app-icon-picker
                    [value]="item.icon"
                    (valueChange)="item.icon = $event"
                    placeholder="Icono"
                    [alignRight]="true"
                  />
                  <select
                    class="px-1 py-0.5 border rounded text-xs w-16"
                    style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                    [(ngModel)]="item.width"
                  >
                    <option value="100">100%</option>
                    <option value="75">75%</option>
                    <option value="50">50%</option>
                    <option value="33">33%</option>
                    <option value="25">25%</option>
                  </select>
                  <button
                    class="p-0.5 rounded-full transition-colors"
                    style="color: var(--color-text-muted)"
                    (click)="
                      isChild
                        ? removeFieldFromChildSection(parentIndex, si, fi)
                        : removeFieldFromSection(si, fi)
                    "
                  >
                    <app-icon name="x" [size]="12"></app-icon>
                  </button>
                </div>
              }
            </div>
          } @else {
            <p class="text-xs py-1" style="color: var(--color-text-muted)">
              Sin campos asignados
            </p>
          }

          <!-- Add field dropdown -->
          @if (
            getAvailableFieldsForSection(si, isChild, parentIndex).length > 0
          ) {
            <div>
              <select
                class="w-full px-2 py-1.5 border rounded-lg text-xs"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                (change)="
                  isChild
                    ? onFieldSelectChild(parentIndex, si, $event)
                    : onFieldSelect(si, $event)
                "
              >
                <option value="">+ Agregar campo...</option>
                @for (
                  field of getAvailableFieldsForSection(
                    si,
                    isChild,
                    parentIndex
                  );
                  track field.id
                ) {
                  <option [value]="field.id">
                    {{ field.label }} ({{ field.field_type }})
                  </option>
                }
              </select>
            </div>
          }

          <!-- Child Sections -->
          @if (!isChild) {
            @for (
              child of section.child_sections;
              track $index;
              let ci = $index
            ) {
              <ng-container
                *ngTemplateOutlet="
                  sectionCard;
                  context: {
                    $implicit: child,
                    si: ci,
                    isChild: true,
                    parentIndex: si,
                  }
                "
              ></ng-container>
            }

            <button
              class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium mt-1"
              style="color: var(--color-primary)"
              (click)="addChildSection(si)"
            >
              <app-icon name="plus" [size]="12"></app-icon>
              Subseccion
            </button>
          }
        </div>
      </div>
    </ng-template>
  `,
})
export class TemplateModalComponent implements OnInit {
  private router = inject(Router);

  template = input<DataCollectionTemplate | null>(null);
  availableFields = input<MetadataField[]>([]);
  availableProducts = input<any[]>([]);
  save = output<any>();
  close = output<void>();

  selectedProductIds: number[] = [];
  activeTabIndex = 0;

  formData: {
    name: string;
    description: string;
    icon: string;
    entity_type: string;
    status: string;
    is_default: boolean;
    use_tabs: boolean;
    tabs: TabForm[];
    sections: SectionForm[];
  } = {
    name: '',
    description: '',
    icon: '',
    entity_type: 'booking',
    status: 'active',
    is_default: false,
    use_tabs: false,
    tabs: [],
    sections: [],
  };

  openAdvancedEditor(templateId: number) {
    this.close.emit();
    this.router.navigate([
      '/admin',
      'data-collection',
      'templates',
      templateId,
      'edit',
    ]);
  }

  ngOnInit() {
    const t = this.template();
    if (t) {
      if (t.tabs?.length) {
        this.formData = {
          name: t.name,
          description: t.description || '',
          icon: (t as any).icon || '',
          entity_type: t.entity_type,
          status: t.status,
          is_default: t.is_default,
          use_tabs: true,
          tabs: t.tabs.map((tab) => ({
            title: tab.title,
            icon: tab.icon || '',
            sort_order: tab.sort_order,
            sections: (tab.sections || []).map((s) => this.mapSectionForm(s)),
          })),
          sections: [],
        };
      } else {
        this.formData = {
          name: t.name,
          description: t.description || '',
          icon: (t as any).icon || '',
          entity_type: t.entity_type,
          status: t.status,
          is_default: t.is_default,
          use_tabs: false,
          tabs: [],
          sections: (t.sections || []).map((s) => this.mapSectionForm(s)),
        };
      }
      this.selectedProductIds = (t.products || []).map((p) => p.product.id);
    }
  }

  // --- Tab Management ---

  addTab() {
    this.formData.tabs.push({
      title: '',
      icon: '',
      sort_order: this.formData.tabs.length,
      sections: [],
    });
    this.activeTabIndex = this.formData.tabs.length - 1;
  }

  removeTab(index: number) {
    this.formData.tabs.splice(index, 1);
    if (this.activeTabIndex >= this.formData.tabs.length) {
      this.activeTabIndex = Math.max(0, this.formData.tabs.length - 1);
    }
  }

  get activeSections(): SectionForm[] {
    if (this.formData.use_tabs && this.formData.tabs.length) {
      return this.formData.tabs[this.activeTabIndex]?.sections || [];
    }
    return this.formData.sections;
  }

  // --- Section Management ---

  addSection() {
    const target = this.activeSections;
    target.push({
      title: '',
      description: '',
      icon: '',
      sort_order: target.length,
      items: [],
      child_sections: [],
    });
  }

  removeSection(index: number) {
    const target = this.activeSections;
    target.splice(index, 1);
    target.forEach((s, i) => (s.sort_order = i));
  }

  // --- Child Section Management ---

  addChildSection(sectionIndex: number) {
    const sections = this.activeSections;
    sections[sectionIndex].child_sections.push({
      title: '',
      description: '',
      icon: '',
      sort_order: sections[sectionIndex].child_sections.length,
      items: [],
      child_sections: [],
    });
  }

  removeChildSection(sectionIndex: number, childIndex: number) {
    this.activeSections[sectionIndex].child_sections.splice(childIndex, 1);
    this.activeSections[sectionIndex].child_sections.forEach(
      (cs, i) => (cs.sort_order = i),
    );
  }

  // --- Field Management ---

  addFieldToSection(sectionIndex: number, fieldId: number) {
    const section = this.activeSections[sectionIndex];
    if (!section.items.find((i) => i.metadata_field_id === fieldId)) {
      section.items.push({
        metadata_field_id: fieldId,
        sort_order: section.items.length,
        is_required: false,
        include_in_summary: false,
        width: '100',
        icon: '',
      });
    }
  }

  addFieldToChildSection(
    parentIndex: number,
    childIndex: number,
    fieldId: number,
  ) {
    const child = this.activeSections[parentIndex].child_sections[childIndex];
    if (!child.items.find((i) => i.metadata_field_id === fieldId)) {
      child.items.push({
        metadata_field_id: fieldId,
        sort_order: child.items.length,
        is_required: false,
        include_in_summary: false,
        width: '100',
        icon: '',
      });
    }
  }

  removeFieldFromSection(sectionIndex: number, itemIndex: number) {
    const section = this.activeSections[sectionIndex];
    section.items.splice(itemIndex, 1);
    section.items.forEach((item, i) => (item.sort_order = i));
  }

  removeFieldFromChildSection(
    parentIndex: number,
    childIndex: number,
    itemIndex: number,
  ) {
    const child = this.activeSections[parentIndex].child_sections[childIndex];
    child.items.splice(itemIndex, 1);
    child.items.forEach((item, i) => (item.sort_order = i));
  }

  onFieldSelect(sectionIndex: number, event: Event) {
    const select = event.target as HTMLSelectElement;
    const fieldId = parseInt(select.value, 10);
    if (fieldId) {
      this.addFieldToSection(sectionIndex, fieldId);
      select.value = '';
    }
  }

  onFieldSelectChild(parentIndex: number, childIndex: number, event: Event) {
    const select = event.target as HTMLSelectElement;
    const fieldId = parseInt(select.value, 10);
    if (fieldId) {
      this.addFieldToChildSection(parentIndex, childIndex, fieldId);
      select.value = '';
    }
  }

  // --- Field Helpers ---

  getFieldLabel(fieldId: number): string {
    return (
      this.availableFields().find((f) => f.id === fieldId)?.label ||
      'Campo desconocido'
    );
  }

  getFieldType(fieldId: number): string {
    return (
      this.availableFields().find((f) => f.id === fieldId)?.field_type || ''
    );
  }

  /**
   * Collects ALL used field IDs across all tabs, sections, and child sections
   * to prevent duplicate field assignment anywhere in the template.
   */
  private getAllUsedFieldIds(): Set<number> {
    const ids = new Set<number>();
    const collectFromSections = (sections: SectionForm[]) => {
      for (const s of sections) {
        for (const item of s.items) {
          ids.add(item.metadata_field_id);
        }
        if (s.child_sections) {
          collectFromSections(s.child_sections);
        }
      }
    };

    // Collect from standalone sections
    collectFromSections(this.formData.sections);

    // Collect from all tabs
    for (const tab of this.formData.tabs) {
      collectFromSections(tab.sections);
    }

    return ids;
  }

  getAvailableFieldsForSection(
    _sectionIndex: number,
    _isChild = false,
    _parentIndex = -1,
  ): MetadataField[] {
    const allUsedIds = this.getAllUsedFieldIds();
    return this.availableFields().filter((f) => !allUsedIds.has(f.id));
  }

  // --- Product Helpers ---

  getProductName(id: number): string {
    return (
      this.availableProducts().find((p) => p.id === id)?.name ||
      'Producto desconocido'
    );
  }

  getUnselectedProducts(): any[] {
    return this.availableProducts().filter(
      (p) => !this.selectedProductIds.includes(p.id),
    );
  }

  onProductSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    const productId = parseInt(select.value, 10);
    if (productId && !this.selectedProductIds.includes(productId)) {
      this.selectedProductIds = [...this.selectedProductIds, productId];
    }
    select.value = '';
  }

  removeProduct(id: number) {
    this.selectedProductIds = this.selectedProductIds.filter(
      (pid) => pid !== id,
    );
  }

  // --- Save ---

  onSave() {
    if (!this.formData.name) return;
    const payload: any = {
      name: this.formData.name,
      description: this.formData.description,
      icon: this.formData.icon || undefined,
      entity_type: this.formData.entity_type,
      status: this.formData.status,
      is_default: this.formData.is_default,
      product_ids: this.selectedProductIds,
    };
    if (this.formData.use_tabs && this.formData.tabs.length) {
      payload.tabs = this.formData.tabs;
      payload.sections = undefined;
    } else {
      payload.sections = this.formData.sections;
      payload.tabs = undefined;
    }
    this.save.emit(payload);
  }

  // --- Mapping Helper ---

  private mapSectionForm(s: any): SectionForm {
    return {
      title: s.title,
      description: s.description || '',
      icon: s.icon || '',
      sort_order: s.sort_order,
      items: (s.items || []).map((i: any) => ({
        metadata_field_id: i.metadata_field_id,
        sort_order: i.sort_order,
        is_required: i.is_required,
        include_in_summary: i.include_in_summary ?? false,
        width: i.width || '100',
        icon: i.icon || '',
      })),
      child_sections: (s.child_sections || []).map((cs: any) =>
        this.mapSectionForm(cs),
      ),
    };
  }
}

