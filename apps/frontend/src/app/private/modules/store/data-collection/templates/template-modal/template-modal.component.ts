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
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
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
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    IconPickerComponent,
    ModalComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    ButtonComponent,
    EmptyStateComponent,
    SettingToggleComponent,
    ToggleComponent,
    ScrollableTabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="true"
      (isOpenChange)="$event === false && close.emit()"
      [title]="template() ? 'Editar Plantilla' : 'Nueva Plantilla'"
      size="lg"
    >
      <!-- Acción contextual: Editor Avanzado en el header del modal -->
      @if (template(); as t) {
        <div slot="header-end">
          <app-button variant="outline" size="sm" (clicked)="openAdvancedEditor(t.id)">
            <app-icon name="settings-2" [size]="14" slot="icon"></app-icon>
            Editor Avanzado
          </app-button>
        </div>
      }

      <!-- Name + Icon -->
      <div class="flex items-center gap-2 mb-4">
        <app-icon-picker
          [value]="formData.icon"
          (valueChange)="formData.icon = $event"
          placeholder="Icono"
        />
        <app-input
          label="Nombre"
          [(ngModel)]="formData.name"
          [required]="true"
          placeholder="Ej: Ficha de cliente"
          class="flex-1"
        />
      </div>

      <!-- Description -->
      <div class="mb-4">
        <app-textarea
          label="Descripcion"
          [(ngModel)]="formData.description"
          [rows]="2"
          placeholder="Descripcion opcional de la plantilla"
        />
      </div>

      <!-- Entity Type + Status -->
      <div class="grid grid-cols-2 gap-4 mb-4">
        <app-selector
          label="Tipo de Entidad"
          [(ngModel)]="formData.entity_type"
          [options]="entityTypeOptions"
          [required]="true"
        />
        <app-selector
          label="Estado"
          [(ngModel)]="formData.status"
          [options]="statusOptions"
          [required]="true"
        />
      </div>

      <!-- Is Default -->
      <div class="mb-3">
        <app-setting-toggle
          label="Plantilla por defecto"
          [(ngModel)]="formData.is_default"
        />
      </div>

      <!-- Use Tabs Toggle -->
      <div class="mb-4">
        <app-setting-toggle
          label="Organizar con pestanas"
          [(ngModel)]="formData.use_tabs"
        />
      </div>

      <!-- Productos Vinculados -->
      @if (availableProducts().length > 0) {
        <div class="mb-4">
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
                  <app-button variant="ghost" size="xsm" (clicked)="removeProduct(pid)">
                    <app-icon name="x" [size]="12" slot="icon"></app-icon>
                  </app-button>
                </div>
              }
            </div>
          }

          <app-selector
            [options]="getUnselectedProductOptions()"
            placeholder="+ Vincular producto..."
            (valueChange)="onProductSelectByValue($event)"
          />
        </div>
      }

      <!-- Divider + Sections/Tabs -->
      <div style="border-top: 1px solid var(--color-border)" class="pt-4">
        <!-- Tab bar (when use_tabs is enabled) -->
        @if (formData.use_tabs) {
          <div class="mb-3">
            <app-scrollable-tabs
              [tabs]="getTabsForScrollable()"
              [activeTab]="getActiveTabId()"
              size="sm"
              (tabChange)="onScrollableTabChange($event)"
            />
            <!-- Tab icon picker + nombre + acciones para el tab activo -->
            @if (formData.tabs[activeTabIndex]) {
              <div class="flex items-center gap-2 mt-2">
                <span class="text-xs shrink-0" style="color: var(--color-text-muted)">Icono:</span>
                <app-icon-picker
                  [value]="formData.tabs[activeTabIndex].icon"
                  (valueChange)="formData.tabs[activeTabIndex].icon = $event"
                  placeholder="Icono tab"
                />
                <app-input
                  [(ngModel)]="formData.tabs[activeTabIndex].title"
                  placeholder="Nombre de la pestana..."
                  class="flex-1"
                />
                <app-button variant="ghost" size="sm" (clicked)="addTab()">
                  <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                  Nueva Pestana
                </app-button>
                <app-button variant="ghost" size="sm" (clicked)="removeTab(activeTabIndex)">
                  <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                </app-button>
              </div>
            } @else {
              <div class="flex justify-end mt-2">
                <app-button variant="ghost" size="sm" (clicked)="addTab()">
                  <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                  Nueva Pestana
                </app-button>
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
          @if (activeSections.length > 0) {
            <app-button variant="outline" size="sm" (clicked)="addSection()">
              <app-icon name="plus" [size]="14" slot="icon"></app-icon>
              Agregar Seccion
            </app-button>
          }
        </div>

        <!-- Empty state -->
        @if (activeSections.length === 0) {
          <app-empty-state
            icon="layers"
            [title]="formData.use_tabs && !formData.tabs.length ? 'Agrega una pestana primero' : 'No hay secciones'"
            [description]="formData.use_tabs && !formData.tabs.length ? 'Crea una pestana para comenzar a agregar secciones.' : 'Agrega secciones para organizar los campos del formulario.'"
            [showActionButton]="!formData.use_tabs || formData.tabs.length > 0"
            actionButtonText="Agregar Seccion"
            actionButtonIcon="plus"
            (actionClick)="addSection()"
          />
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

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-end gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSave()" [disabled]="!formData.name">
          {{ template() ? 'Guardar' : 'Crear' }}
        </app-button>
      </div>
    </app-modal>

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
          <app-input
            [(ngModel)]="section.title"
            placeholder="Nombre de la seccion"
            class="flex-1"
          />
          <app-icon-picker
            [value]="section.icon"
            (valueChange)="section.icon = $event"
            placeholder="Icono"
            [alignRight]="true"
          />
          <app-button variant="ghost" size="xsm" (clicked)="isChild ? removeChildSection(parentIndex, si) : removeSection(si)">
            <app-icon name="trash-2" [size]="14" slot="icon" style="color: var(--color-error)"></app-icon>
          </app-button>
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
                  <app-toggle [(ngModel)]="item.is_required" label="Req" />
                  <app-toggle [(ngModel)]="item.include_in_summary" label="Resumen" />
                  <app-icon-picker
                    [value]="item.icon"
                    (valueChange)="item.icon = $event"
                    placeholder="Icono"
                    [alignRight]="true"
                  />
                  <div class="w-20 shrink-0">
                    <app-selector
                      [(ngModel)]="item.width"
                      [options]="widthOptions"
                      size="sm"
                    />
                  </div>
                  <app-button variant="ghost" size="xsm" (clicked)="isChild ? removeFieldFromChildSection(parentIndex, si, fi) : removeFieldFromSection(si, fi)">
                    <app-icon name="x" [size]="12" slot="icon"></app-icon>
                  </app-button>
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
              <app-selector
                [options]="getFieldOptions(si, isChild, parentIndex)"
                placeholder="+ Agregar campo..."
                (valueChange)="onFieldSelectByValue(si, isChild, parentIndex, $event)"
              />
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

            <app-button variant="ghost" size="sm" (clicked)="addChildSection(si)">
              <app-icon name="plus" [size]="12" slot="icon"></app-icon>
              Subseccion
            </app-button>
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

  entityTypeOptions = [
    { value: 'customer', label: 'Cliente' },
    { value: 'booking', label: 'Reserva' },
    { value: 'order', label: 'Orden' },
  ];

  statusOptions = [
    { value: 'active', label: 'Activo' },
    { value: 'inactive', label: 'Inactivo' },
    { value: 'archived', label: 'Archivado' },
  ];

  widthOptions = [
    { value: '100', label: '100%' },
    { value: '75', label: '75%' },
    { value: '50', label: '50%' },
    { value: '33', label: '33%' },
    { value: '25', label: '25%' },
  ];

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

  // --- ScrollableTabs helpers ---

  getTabsForScrollable(): ScrollableTab[] {
    return this.formData.tabs.map((tab, i) => ({
      id: String(i),
      label: tab.title || `Pestana ${i + 1}`,
      icon: tab.icon || undefined,
    }));
  }

  getActiveTabId(): string {
    return String(this.activeTabIndex);
  }

  onScrollableTabChange(tabId: string) {
    this.activeTabIndex = Number(tabId);
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

  getFieldOptions(si: number, isChild: boolean, parentIndex: number) {
    return this.getAvailableFieldsForSection(si, isChild, parentIndex).map(
      (f) => ({
        value: String(f.id),
        label: f.label + ' (' + f.field_type + ')',
      }),
    );
  }

  onFieldSelectByValue(
    si: number,
    isChild: boolean,
    parentIndex: number,
    value: string | number | null,
  ) {
    const fieldId = parseInt(String(value), 10);
    if (!fieldId) return;
    if (isChild) this.addFieldToChildSection(parentIndex, si, fieldId);
    else this.addFieldToSection(si, fieldId);
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

  getUnselectedProductOptions() {
    return this.getUnselectedProducts().map((p) => ({
      value: p.id,
      label: p.name,
    }));
  }

  onProductSelectByValue(value: string | number | null) {
    const productId = typeof value === 'string' ? parseInt(value, 10) : value;
    if (productId && !this.selectedProductIds.includes(productId as number)) {
      this.selectedProductIds = [...this.selectedProductIds, productId as number];
    }
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
