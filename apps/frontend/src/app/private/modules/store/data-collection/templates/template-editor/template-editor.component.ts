import {Component, ChangeDetectionStrategy, signal, computed, inject, OnInit, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import {
  DataCollectionTemplate,
  TemplateTab,
  TemplateSection,
  TemplateItem,
} from '../../interfaces/data-collection-template.interface';
import { MetadataField } from '../../interfaces/metadata-field.interface';
import { DataCollectionTemplatesService } from '../../services/data-collection-templates.service';
import { MetadataFieldsService } from '../../services/metadata-fields.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { IconPickerComponent } from '../../../../../../shared/components/icon-picker/icon-picker.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { environment } from '../../../../../../../environments/environment';
import { DynamicFieldComponent } from '../../../../ecommerce/pages/data-collection-form/components/dynamic-field/dynamic-field.component';
import { getItemWidth } from '../../utils/item-width.util';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';

interface ItemForm {
  metadata_field_id: number;
  sort_order: number;
  is_required: boolean;
  include_in_summary: boolean;
  width: string;
  icon: string;
  help_text: string;
  placeholder: string;
}

interface SectionForm {
  id?: number;
  title: string;
  description: string;
  icon: string;
  sort_order: number;
  items: ItemForm[];
  child_sections: SectionForm[];
  expanded: boolean;
}

interface TabForm {
  id?: number;
  title: string;
  icon: string;
  sort_order: number;
  sections: SectionForm[];
}

interface Selection {
  type: 'tab' | 'section' | 'item';
  tabIndex?: number;
  sectionIndex?: number;
  childSectionIndex?: number;
  itemIndex?: number;
}

@Component({
  selector: 'app-template-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    IconPickerComponent,
    StickyHeaderComponent,
    DynamicFieldComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    SettingToggleComponent,
    ScrollableTabsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center h-64">
        <app-spinner size="md" />
      </div>
    } @else if (template()) {
      <app-sticky-header
        [title]="templateName()"
        subtitle="Editor de plantilla"
        icon="layout-template"
        [showBackButton]="true"
        backRoute="/admin/data-collection/templates"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="flex flex-col lg:flex-row gap-0 h-[calc(100vh-140px)]">
        @if (showPreview()) {
          <!-- Preview Mode: Full width -->
          <div
            class="flex-1 overflow-y-auto"
            style="background: var(--color-background)"
          >
            <!-- Preview content -->
            <div class="px-4 sm:px-6 py-6">
              @if (previewSteps()[previewStep()]; as step) {
                @if (previewSteps().length > 1 && step.title) {
                  <div class="mb-5">
                    <h2
                      class="text-lg font-bold flex items-center gap-2"
                      style="color: var(--color-text)"
                    >
                      @if (step.icon) {
                        <app-icon
                          [name]="step.icon"
                          [size]="20"
                          color="var(--color-primary)"
                        ></app-icon>
                      }
                      {{ step.title }}
                    </h2>
                  </div>
                }
                @for (section of step.sections; track section.title) {
                  <div
                    class="mb-6 rounded-xl p-4"
                    style="background: var(--color-surface); border: 1px solid var(--color-border)"
                  >
                    <div class="flex items-center gap-2 mb-3">
                      @if (section.icon) {
                        <app-icon
                          [name]="section.icon"
                          [size]="16"
                          color="var(--color-primary)"
                        ></app-icon>
                      }
                      <h3
                        class="text-sm font-semibold"
                        style="color: var(--color-text)"
                      >
                        {{ section.title }}
                      </h3>
                    </div>
                    @if (section.description) {
                      <p
                        class="text-xs mb-3"
                        style="color: var(--color-text-muted)"
                      >
                        {{ section.description }}
                      </p>
                    }
                    <div class="flex flex-wrap gap-3">
                      @for (
                        item of section.items;
                        track item.metadata_field_id
                      ) {
                        @if (resolveField(item.metadata_field_id); as field) {
                          <div [style.width]="getItemWidth(item.width)">
                            <app-dynamic-field
                              [field]="field"
                              [required]="item.is_required"
                              value=""
                            />
                          </div>
                        } @else {
                          <div
                            [style.width]="getItemWidth(item.width)"
                            class="mb-4"
                          >
                            <label
                              class="block text-sm font-medium mb-1"
                              style="color: var(--color-text-muted)"
                              >Campo no disponible</label
                            >
                            <div
                              class="px-3 py-2.5 border rounded-lg text-sm"
                              style="border-color: var(--color-border); background: var(--color-surface-secondary); color: var(--color-text-muted)"
                            >
                              El campo seleccionado ya no existe
                            </div>
                          </div>
                        }
                      }
                    </div>
                    <!-- Child sections -->
                    @for (child of section.child_sections; track child.title) {
                      <div
                        class="ml-4 pl-4 mt-4"
                        style="border-left: 2px solid var(--color-border)"
                      >
                        <div class="flex items-center gap-2 mb-3">
                          @if (child.icon) {
                            <app-icon
                              [name]="child.icon"
                              [size]="14"
                              color="var(--color-text-muted)"
                            ></app-icon>
                          }
                          <h4
                            class="text-sm font-semibold"
                            style="color: var(--color-text)"
                          >
                            {{ child.title }}
                          </h4>
                        </div>
                        <div class="flex flex-wrap gap-3">
                          @for (
                            item of child.items;
                            track item.metadata_field_id
                          ) {
                            @if (
                              resolveField(item.metadata_field_id);
                              as field
                            ) {
                              <div [style.width]="getItemWidth(item.width)">
                                <app-dynamic-field
                                  [field]="field"
                                  [required]="item.is_required"
                                  value=""
                                />
                              </div>
                            }
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
                @if (step.sections.length === 0) {
                  <app-empty-state
                    icon="file-text"
                    title="Sin campos"
                    description="Este paso no tiene campos asignados."
                    [showActionButton]="false"
                  />
                }
              }
            </div>
          </div>
        } @else {
          <!-- Editor Mode: 2-column layout -->

          <!-- Left Canvas (65%) -->
          <div class="flex-1 lg:w-[65%] overflow-y-auto p-4 sm:p-6 space-y-4">
            <!-- Tab Bar -->
            @if (formData().use_tabs) {
              <div class="flex items-center gap-2 mb-3">
                <div class="flex-1 min-w-0">
                  <app-scrollable-tabs
                    [tabs]="editorTabsList()"
                    [activeTab]="activeTabId()"
                    size="sm"
                    (tabChange)="selectTabById($event)"
                  />
                </div>
                <app-button variant="ghost" size="sm" (clicked)="addTab()">
                  <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                  Pestaña
                </app-button>
                @if (formData().tabs.length > 0) {
                  <app-button variant="ghost" size="sm" (clicked)="removeTab(activeTabIndex())">
                    <app-icon name="trash-2" [size]="14" slot="icon"></app-icon>
                  </app-button>
                }
              </div>
            }

            <!-- Sections -->
            @if (activeSections().length === 0) {
              <app-empty-state
                icon="layers"
                [title]="formData().use_tabs && !formData().tabs.length ? 'Agrega una pestaña primero' : 'No hay secciones'"
                [description]="formData().use_tabs && !formData().tabs.length ? 'Crea una pestaña para comenzar a agregar secciones.' : 'Agrega secciones para organizar los campos del formulario.'"
                [showActionButton]="!formData().use_tabs || formData().tabs.length > 0"
                actionButtonText="Agregar Sección"
                actionButtonIcon="plus"
                (actionClick)="addSection()"
              />
            }

            @for (section of activeSections(); track $index; let si = $index) {
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

            <!-- Add Section Button -->
            <app-button variant="outline" [fullWidth]="true" (clicked)="addSection()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Agregar Sección
            </app-button>
          </div>

          <!-- Right Properties Panel (35%) -->
          <div
            class="lg:w-[35%] lg:min-w-[300px] lg:max-w-[420px] overflow-y-auto"
            style="border-left: 1px solid var(--color-border); background: var(--color-surface-secondary)"
          >
            <div class="p-4 space-y-4">
              <!-- Template Settings (always visible) -->
              <div>
                <h3
                  class="text-xs font-semibold uppercase tracking-wider mb-3"
                  style="color: var(--color-text-muted)"
                >
                  Configuracion General
                </h3>
                <div class="space-y-3">
                  <div>
                    <label
                      class="block text-xs font-medium mb-1"
                      style="color: var(--color-text)"
                      >Nombre *</label
                    >
                    <div class="flex items-center gap-2">
                      <app-icon-picker
                        [value]="formData().icon"
                        (valueChange)="updateFormData('icon', $event)"
                        placeholder="Icono"
                      />
                      <div class="flex-1">
                        <app-input
                          [ngModel]="formData().name"
                          (ngModelChange)="updateFormData('name', $event)"
                          placeholder="Nombre de la plantilla"
                        />
                      </div>
                    </div>
                  </div>
                  <app-textarea
                    label="Descripción"
                    [ngModel]="formData().description"
                    (ngModelChange)="updateFormData('description', $event)"
                    [rows]="2"
                    placeholder="Descripción opcional"
                  />
                  <div class="grid grid-cols-2 gap-3">
                    <app-selector
                      label="Tipo de Entidad"
                      [ngModel]="formData().entity_type"
                      (ngModelChange)="updateFormData('entity_type', $event)"
                      [options]="entityTypeOptions"
                    />
                    <app-selector
                      label="Estado"
                      [ngModel]="formData().status"
                      (ngModelChange)="updateFormData('status', $event)"
                      [options]="statusOptions"
                    />
                  </div>
                  <app-setting-toggle
                    label="Plantilla por defecto"
                    [ngModel]="formData().is_default"
                    (ngModelChange)="updateFormData('is_default', $event)"
                  />
                  <app-setting-toggle
                    label="Organizar con pestañas"
                    [ngModel]="formData().use_tabs"
                    (ngModelChange)="updateFormData('use_tabs', $event)"
                  />

                  <!-- Products -->
                  <div>
                    <label
                      class="block text-xs font-medium mb-1"
                      style="color: var(--color-text)"
                      >Productos Vinculados</label
                    >
                    @if (selectedProductIds().length > 0) {
                      <div class="flex flex-wrap gap-1.5 mb-2">
                        @for (pid of selectedProductIds(); track pid) {
                          <div
                            class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                            style="background: var(--color-surface); color: var(--color-text)"
                          >
                            <span class="font-medium">{{
                              getProductName(pid)
                            }}</span>
                            <app-button variant="ghost" size="xsm" (clicked)="removeProduct(pid)">
                              <app-icon name="x" [size]="10" slot="icon"></app-icon>
                            </app-button>
                          </div>
                        }
                      </div>
                    }
                    <app-selector
                      [ngModel]="''"
                      (ngModelChange)="onProductSelectByValue($event)"
                      [options]="getUnselectedProductOptions()"
                      placeholder="+ Vincular producto..."
                    />
                  </div>
                </div>
              </div>

              <div style="border-top: 1px solid var(--color-border)"></div>

              <!-- Contextual Properties -->
              @if (selection()) {
                <div>
                  <h3
                    class="text-xs font-semibold uppercase tracking-wider mb-3"
                    style="color: var(--color-text-muted)"
                  >
                    {{ selectionTypeLabel() }}
                  </h3>

                  <!-- Tab Properties -->
                  @if (selection()?.type === 'tab') {
                    <div class="space-y-3">
                      <app-input
                        label="Título"
                        [ngModel]="selectedTab()?.title"
                        (ngModelChange)="updateSelectedTab('title', $event)"
                      />
                      <div>
                        <label
                          class="block text-xs font-medium mb-1"
                          style="color: var(--color-text)"
                          >Icono</label
                        >
                        <app-icon-picker
                          [value]="selectedTab()?.icon || ''"
                          (valueChange)="updateSelectedTab('icon', $event)"
                          placeholder="Icono tab"
                        />
                      </div>
                      <p class="text-xs" style="color: var(--color-text-muted)">
                        {{ selectedTab()?.sections?.length || 0 }} secciones en
                        esta pestaña
                      </p>
                    </div>
                  }

                  <!-- Section Properties -->
                  @if (selection()?.type === 'section') {
                    <div class="space-y-3">
                      <app-input
                        label="Título"
                        [ngModel]="selectedSection()?.title"
                        (ngModelChange)="updateSelectedSection('title', $event)"
                      />
                      <app-textarea
                        label="Descripción"
                        [ngModel]="selectedSection()?.description"
                        (ngModelChange)="updateSelectedSection('description', $event)"
                        [rows]="2"
                        placeholder="Descripción de la sección"
                      />
                      <div>
                        <label
                          class="block text-xs font-medium mb-1"
                          style="color: var(--color-text)"
                          >Icono</label
                        >
                        <app-icon-picker
                          [value]="selectedSection()?.icon || ''"
                          (valueChange)="updateSelectedSection('icon', $event)"
                          placeholder="Icono seccion"
                        />
                      </div>
                      <p class="text-xs" style="color: var(--color-text-muted)">
                        {{ selectedSection()?.items?.length || 0 }} campos
                        &middot;
                        {{ selectedSection()?.child_sections?.length || 0 }}
                        subsecciones
                      </p>
                    </div>
                  }

                  <!-- Item Properties -->
                  @if (selection()?.type === 'item') {
                    <div class="space-y-3">
                      <div>
                        <label
                          class="block text-xs font-medium mb-1"
                          style="color: var(--color-text)"
                          >Campo</label
                        >
                        <div
                          class="px-3 py-2 border rounded-lg text-sm"
                          style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
                        >
                          {{
                            getFieldLabel(selectedItem()?.metadata_field_id!)
                          }}
                          <span
                            class="text-xs ml-1"
                            style="color: var(--color-text-muted)"
                          >
                            ({{
                              getFieldType(selectedItem()?.metadata_field_id!)
                            }})
                          </span>
                        </div>
                      </div>
                      <app-selector
                        label="Ancho"
                        [ngModel]="selectedItem()?.width"
                        (ngModelChange)="updateSelectedItem('width', $event)"
                        [options]="widthOptions"
                      />
                      <div>
                        <label
                          class="block text-xs font-medium mb-1"
                          style="color: var(--color-text)"
                          >Icono</label
                        >
                        <app-icon-picker
                          [value]="selectedItem()?.icon || ''"
                          (valueChange)="updateSelectedItem('icon', $event)"
                          placeholder="Icono campo"
                        />
                      </div>
                      <app-setting-toggle
                        label="Requerido"
                        [ngModel]="selectedItem()?.is_required"
                        (ngModelChange)="updateSelectedItem('is_required', $event)"
                      />
                      <app-setting-toggle
                        label="Incluir en resumen"
                        [ngModel]="selectedItem()?.include_in_summary"
                        (ngModelChange)="updateSelectedItem('include_in_summary', $event)"
                      />
                      <app-input
                        label="Texto de ayuda"
                        [ngModel]="selectedItem()?.help_text"
                        (ngModelChange)="updateSelectedItem('help_text', $event)"
                        placeholder="Texto de ayuda para el campo"
                      />
                      <app-input
                        label="Placeholder"
                        [ngModel]="selectedItem()?.placeholder"
                        (ngModelChange)="updateSelectedItem('placeholder', $event)"
                        placeholder="Placeholder del campo"
                      />
                    </div>
                  }
                </div>
              } @else {
                <app-empty-state
                  icon="mouse-pointer-click"
                  title="Sin selección"
                  description="Selecciona un elemento del canvas para ver sus propiedades."
                  [showActionButton]="false"
                />
              }
            </div>
          </div>
        }
      </div>

      <ng-template
        #sectionCard
        let-section
        let-si="si"
        let-isChild="isChild"
        let-parentIndex="parentIndex"
      >
        <div
          class="border rounded-xl mb-3 overflow-hidden transition-all"
          [class.ml-4]="isChild"
          [style.border-color]="
            isElementSelected('section', si, isChild, parentIndex)
              ? 'var(--color-primary)'
              : isChild
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
            class="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
            style="background: var(--color-surface-secondary)"
            (click)="
              toggleSection(si, isChild, parentIndex);
              selectSectionElement(si, isChild, parentIndex)
            "
          >
            <app-icon
              [name]="section.expanded ? 'chevron-down' : 'chevron-right'"
              [size]="14"
              color="var(--color-text-muted)"
            ></app-icon>
            <app-input
              class="flex-1"
              [ngModel]="section.title"
              (ngModelChange)="updateSectionTitle(si, $event, isChild, parentIndex)"
              placeholder="Nombre de la seccion"
              (click)="$event.stopPropagation()"
            />
            @if (section.icon) {
              <app-icon
                [name]="section.icon"
                [size]="14"
                color="var(--color-text-muted)"
              ></app-icon>
            }
            <app-badge variant="neutral">{{ section.items.length }} campos</app-badge>
            <app-button
              variant="ghost"
              size="xsm"
              (click)="$event.stopPropagation()"
              (clicked)="isChild ? removeChildSection(parentIndex, si) : removeSection(si)"
            >
              <app-icon name="trash-2" [size]="14" slot="icon" style="color: var(--color-error)"></app-icon>
            </app-button>
          </div>

          <!-- Section Body (expandable) -->
          @if (section.expanded) {
            <div
              class="px-3 py-3 space-y-2"
              style="background: var(--color-surface)"
            >
              <!-- Items -->
              @if (section.items.length > 0) {
                <div class="space-y-1.5">
                  @for (item of section.items; track $index; let fi = $index) {
                    <div
                      class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors"
                      [style.background]="
                        isItemSelected(si, fi, isChild, parentIndex)
                          ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                          : 'var(--color-surface-secondary)'
                      "
                      [style.border]="
                        isItemSelected(si, fi, isChild, parentIndex)
                          ? '1px solid var(--color-primary)'
                          : '1px solid transparent'
                      "
                      (click)="selectItem(si, fi, isChild, parentIndex)"
                    >
                      <span class="opacity-50">{{
                        getFieldType(item.metadata_field_id)
                      }}</span>
                      <span
                        class="font-medium flex-1"
                        style="color: var(--color-text)"
                        >{{ getFieldLabel(item.metadata_field_id) }}</span
                      >
                      <app-badge variant="neutral">{{ item.width }}%</app-badge>
                      @if (item.is_required) {
                        <app-badge variant="error">Req</app-badge>
                      }
                      <app-button
                        variant="ghost"
                        size="xsm"
                        (click)="$event.stopPropagation()"
                        (clicked)="isChild ? removeFieldFromChildSection(parentIndex, si, fi) : removeFieldFromSection(si, fi)"
                      >
                        <app-icon name="x" [size]="12" slot="icon"></app-icon>
                      </app-button>
                    </div>
                  }
                </div>
              } @else {
                <p
                  class="text-xs py-2 text-center"
                  style="color: var(--color-text-muted)"
                >
                  Sin campos asignados
                </p>
              }

              <!-- Add field dropdown -->
              @if (
                getAvailableFieldsForSection(si, isChild, parentIndex).length >
                0
              ) {
                <div>
                  <app-selector
                    [ngModel]="''"
                    (ngModelChange)="isChild ? onFieldSelectByValue(parentIndex, si, $event) : onFieldSelectByValue(-1, si, $event)"
                    [options]="getFieldOptionsForSection(si, isChild, parentIndex)"
                    placeholder="+ Agregar campo..."
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
                  Subsección
                </app-button>
              }
            </div>
          }
        </div>
      </ng-template>
    }
  `,
})
export class TemplateEditorComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private templatesService = inject(DataCollectionTemplatesService);
  private fieldsService = inject(MetadataFieldsService);
  private toastService = inject(ToastService);
  private http = inject(HttpClient);

  template = signal<DataCollectionTemplate | null>(null);
  loading = signal(true);
  saving = signal(false);
  availableFields = signal<MetadataField[]>([]);
  availableProducts = signal<any[]>([]);
  activeTabIndex = signal(0);
  selectedProductIds = signal<number[]>([]);
  selection = signal<Selection | null>(null);
  showPreview = signal(false);
  previewStep = signal(0);
  getItemWidth = getItemWidth;

  // Options for selectors
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

  formData = signal<{
    name: string;
    description: string;
    icon: string;
    entity_type: string;
    status: string;
    is_default: boolean;
    use_tabs: boolean;
    tabs: TabForm[];
    sections: SectionForm[];
  }>({
    name: '',
    description: '',
    icon: '',
    entity_type: 'booking',
    status: 'active',
    is_default: false,
    use_tabs: false,
    tabs: [],
    sections: [],
  });

  templateName = computed(() => this.formData().name || 'Nueva Plantilla');

  previewSteps = computed(() => {
    const fd = this.formData();
    if (fd.use_tabs && fd.tabs.length > 0) {
      return fd.tabs
        .map((tab) => ({
          title: tab.title,
          icon: tab.icon,
          sections: tab.sections.filter(
            (s) => s.items.length > 0 || s.child_sections?.length,
          ),
        }))
        .filter((tab) => tab.sections.length > 0);
    }
    const sections = fd.sections.filter(
      (s) => s.items.length > 0 || s.child_sections?.length,
    );
    if (sections.length === 0) return [];
    return [{ title: fd.name || 'Formulario', icon: '', sections }];
  });

  headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'save',
      label: 'Guardar',
      variant: 'primary',
      icon: 'save',
      loading: this.saving(),
      disabled: !this.formData().name,
    },
    {
      id: 'preview',
      label: this.showPreview() ? 'Cerrar Previa' : 'Vista Previa',
      variant: 'outline',
      icon: this.showPreview() ? 'pencil' : 'eye',
    },
  ]);

  activeSections = computed<SectionForm[]>(() => {
    const fd = this.formData();
    if (fd.use_tabs && fd.tabs.length) {
      return fd.tabs[this.activeTabIndex()]?.sections || [];
    }
    return fd.sections;
  });

  selectionTypeLabel = computed(() => {
    const s = this.selection();
    if (!s) return '';
    if (s.type === 'tab') return 'Propiedades de Pestaña';
    if (s.type === 'section') return 'Propiedades de Sección';
    return 'Propiedades del Campo';
  });

  selectedTab = computed<TabForm | null>(() => {
    const s = this.selection();
    if (s?.type !== 'tab') return null;
    return this.formData().tabs[s.tabIndex!] ?? null;
  });

  selectedSection = computed<SectionForm | null>(() => {
    const s = this.selection();
    if (s?.type !== 'section') return null;
    return this.resolveSection(s);
  });

  selectedItem = computed<ItemForm | null>(() => {
    const s = this.selection();
    if (s?.type !== 'item') return null;
    const section = this.resolveSection(s);
    return section?.items[s.itemIndex!] ?? null;
  });

  // Computed for scrollable tabs
  readonly editorTabsList = computed<ScrollableTab[]>(() =>
    this.formData().tabs.map((tab, i) => ({
      id: String(i),
      label: tab.title || `Pestaña ${i + 1}`,
      icon: tab.icon || undefined,
    }))
  );

  readonly activeTabId = computed(() => String(this.activeTabIndex()));

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.toastService.error('ID de plantilla no valido');
      this.router.navigate(['/admin/data-collection/templates']);
      return;
    }

    this.templatesService.getOne(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (t) => {
        this.template.set(t);
        this.initFormData(t);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
        this.router.navigate(['/admin/data-collection/templates']);
      },
    });

    this.loadAvailableFields();
    this.loadAvailableProducts();
  }

  private initFormData(t: DataCollectionTemplate) {
    if (t.tabs?.length) {
      this.formData.set({
        name: t.name,
        description: t.description || '',
        icon: t.icon || '',
        entity_type: t.entity_type,
        status: t.status,
        is_default: t.is_default,
        use_tabs: true,
        tabs: t.tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          icon: tab.icon || '',
          sort_order: tab.sort_order,
          sections: (tab.sections || []).map((s) => this.mapSectionForm(s)),
        })),
        sections: [],
      });
    } else {
      this.formData.set({
        name: t.name,
        description: t.description || '',
        icon: t.icon || '',
        entity_type: t.entity_type,
        status: t.status,
        is_default: t.is_default,
        use_tabs: false,
        tabs: [],
        sections: (t.sections || []).map((s) => this.mapSectionForm(s)),
      });
    }
    this.selectedProductIds.set((t.products || []).map((p) => p.product.id));
  }

  private mapSectionForm(s: TemplateSection): SectionForm {
    return {
      id: s.id,
      title: s.title,
      description: s.description || '',
      icon: s.icon || '',
      sort_order: s.sort_order,
      expanded: true,
      items: (s.items || []).map((i) => ({
        metadata_field_id: i.metadata_field_id,
        sort_order: i.sort_order,
        is_required: i.is_required,
        include_in_summary: i.include_in_summary ?? false,
        width: i.width || '100',
        icon: i.icon || '',
        help_text: i.help_text || '',
        placeholder: i.placeholder || '',
      })),
      child_sections: (s.child_sections || []).map((cs) =>
        this.mapSectionForm(cs),
      ),
    };
  }

  private resolveSection(s: Selection): SectionForm | null {
    const fd = this.formData();
    let sections: SectionForm[];
    if (
      s.childSectionIndex !== undefined &&
      s.childSectionIndex !== null &&
      s.childSectionIndex >= 0
    ) {
      const parent = this.getSectionsList(fd)[s.sectionIndex!];
      return parent?.child_sections?.[s.childSectionIndex!] ?? null;
    }
    sections = this.getSectionsList(fd);
    return sections[s.sectionIndex!] ?? null;
  }

  private getSectionsList(fd: {
    use_tabs: boolean;
    tabs: TabForm[];
    sections: SectionForm[];
  }): SectionForm[] {
    if (fd.use_tabs && fd.tabs.length) {
      return fd.tabs[this.activeTabIndex()]?.sections || [];
    }
    return fd.sections;
  }

  private mutateActiveSections(updater: (sections: SectionForm[]) => void) {
    this.formData.update((fd) => {
      const copy = { ...fd };
      if (copy.use_tabs && copy.tabs.length) {
        const tabs = [...copy.tabs];
        const ti = this.activeTabIndex();
        tabs[ti] = { ...tabs[ti], sections: [...tabs[ti].sections] };
        updater(tabs[ti].sections);
        copy.tabs = tabs;
      } else {
        copy.sections = [...copy.sections];
        updater(copy.sections);
      }
      return copy;
    });
  }

  // --- Header Actions ---

  onHeaderAction(id: string) {
    if (id === 'save') this.save();
    if (id === 'preview') this.togglePreview();
  }

  save() {
    const fd = this.formData();
    if (!fd.name) return;
    this.saving.set(true);

    const t = this.template()!;
    const payload: any = {
      name: fd.name,
      description: fd.description,
      icon: fd.icon || undefined,
      entity_type: fd.entity_type,
      status: fd.status,
      is_default: fd.is_default,
    };

    if (fd.use_tabs && fd.tabs.length) {
      payload.tabs = fd.tabs.map((tab) => ({
        ...tab,
        sections: tab.sections.map((s) => this.cleanSectionForPayload(s)),
      }));
    } else {
      payload.sections = fd.sections.map((s) => this.cleanSectionForPayload(s));
    }

    const productIds = this.selectedProductIds();

    this.templatesService.update(t.id, payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        if (productIds.length >= 0) {
          this.templatesService.assignProducts(t.id, productIds).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
              this.saving.set(false);
              this.toastService.success('Plantilla actualizada');
            },
            error: () => {
              this.saving.set(false);
              this.toastService.warning(
                'Plantilla guardada, pero error asignando productos',
              );
            },
          });
        } else {
          this.saving.set(false);
          this.toastService.success('Plantilla actualizada');
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  private cleanSectionForPayload(s: SectionForm): any {
    return {
      title: s.title,
      description: s.description,
      icon: s.icon,
      sort_order: s.sort_order,
      items: s.items.map((i) => ({
        metadata_field_id: i.metadata_field_id,
        sort_order: i.sort_order,
        is_required: i.is_required,
        include_in_summary: i.include_in_summary,
        width: i.width,
        icon: i.icon,
        help_text: i.help_text,
        placeholder: i.placeholder,
      })),
      child_sections: (s.child_sections || []).map((cs) =>
        this.cleanSectionForPayload(cs),
      ),
    };
  }

  preview() {
    if (this.previewSteps().length === 0) {
      this.toastService.info('La plantilla no tiene campos para previsualizar');
      return;
    }
    this.previewStep.set(0);
    this.showPreview.set(true);
  }

  togglePreview() {
    if (this.showPreview()) {
      this.showPreview.set(false);
    } else {
      if (this.previewSteps().length === 0) {
        this.toastService.info(
          'La plantilla no tiene campos para previsualizar',
        );
        return;
      }
      this.previewStep.set(0);
      this.showPreview.set(true);
    }
  }

  nextPreviewStep() {
    this.previewStep.update((s) =>
      Math.min(s + 1, this.previewSteps().length - 1),
    );
  }

  prevPreviewStep() {
    this.previewStep.update((s) => Math.max(0, s - 1));
  }

  previewProgressPercent(): number {
    const steps = this.previewSteps();
    if (steps.length <= 1) return 100;
    return Math.round(((this.previewStep() + 1) / steps.length) * 100);
  }

  resolveField(fieldId: number): MetadataField | null {
    return this.availableFields().find((f) => f.id === fieldId) || null;
  }

  // --- Form Data Updates ---

  updateFormData(key: string, value: any) {
    this.formData.update((fd) => ({ ...fd, [key]: value }));
  }

  // --- Tab Management ---

  selectTab(index: number) {
    this.activeTabIndex.set(index);
    this.selection.set({ type: 'tab', tabIndex: index });
  }

  selectTabById(tabId: string): void {
    this.selectTab(Number(tabId));
  }

  addTab() {
    this.formData.update((fd) => ({
      ...fd,
      tabs: [
        ...fd.tabs,
        {
          title: '',
          icon: '',
          sort_order: fd.tabs.length,
          sections: [],
        },
      ],
    }));
    this.activeTabIndex.set(this.formData().tabs.length - 1);
  }

  removeTab(index: number) {
    this.formData.update((fd) => {
      const tabs = fd.tabs.filter((_, i) => i !== index);
      tabs.forEach((t, i) => (t.sort_order = i));
      return { ...fd, tabs };
    });
    const ati = this.activeTabIndex();
    if (ati >= this.formData().tabs.length) {
      this.activeTabIndex.set(Math.max(0, this.formData().tabs.length - 1));
    }
  }

  updateTabTitle(tabIndex: number, title: string) {
    this.formData.update((fd) => {
      const tabs = [...fd.tabs];
      tabs[tabIndex] = { ...tabs[tabIndex], title };
      return { ...fd, tabs };
    });
  }

  updateSelectedTab(key: string, value: any) {
    const s = this.selection();
    if (!s || s.type !== 'tab') return;
    this.formData.update((fd) => {
      const tabs = [...fd.tabs];
      tabs[s.tabIndex!] = { ...tabs[s.tabIndex!], [key]: value };
      return { ...fd, tabs };
    });
  }

  // --- Section Management ---

  addSection() {
    this.mutateActiveSections((sections) => {
      sections.push({
        title: '',
        description: '',
        icon: '',
        sort_order: sections.length,
        items: [],
        child_sections: [],
        expanded: true,
      });
    });
  }

  removeSection(index: number) {
    this.mutateActiveSections((sections) => {
      sections.splice(index, 1);
      sections.forEach((s, i) => (s.sort_order = i));
    });
    this.clearSelectionIfMatches('section', index);
  }

  addChildSection(sectionIndex: number) {
    this.mutateActiveSections((sections) => {
      const section = {
        ...sections[sectionIndex],
        child_sections: [...sections[sectionIndex].child_sections],
      };
      section.child_sections.push({
        title: '',
        description: '',
        icon: '',
        sort_order: section.child_sections.length,
        items: [],
        child_sections: [],
        expanded: true,
      });
      sections[sectionIndex] = section;
    });
  }

  removeChildSection(parentIndex: number, childIndex: number) {
    this.mutateActiveSections((sections) => {
      const parent = {
        ...sections[parentIndex],
        child_sections: [...sections[parentIndex].child_sections],
      };
      parent.child_sections.splice(childIndex, 1);
      parent.child_sections.forEach((cs, i) => (cs.sort_order = i));
      sections[parentIndex] = parent;
    });
  }

  toggleSection(si: number, isChild: boolean, parentIndex: number) {
    this.mutateActiveSections((sections) => {
      if (isChild && parentIndex >= 0) {
        const parent = {
          ...sections[parentIndex],
          child_sections: [...sections[parentIndex].child_sections],
        };
        const child = {
          ...parent.child_sections[si],
          expanded: !parent.child_sections[si].expanded,
        };
        parent.child_sections[si] = child;
        sections[parentIndex] = parent;
      } else {
        sections[si] = { ...sections[si], expanded: !sections[si].expanded };
      }
    });
  }

  updateSectionTitle(
    si: number,
    title: string,
    isChild: boolean,
    parentIndex: number,
  ) {
    this.mutateActiveSections((sections) => {
      if (isChild && parentIndex >= 0) {
        const parent = {
          ...sections[parentIndex],
          child_sections: [...sections[parentIndex].child_sections],
        };
        parent.child_sections[si] = { ...parent.child_sections[si], title };
        sections[parentIndex] = parent;
      } else {
        sections[si] = { ...sections[si], title };
      }
    });
  }

  updateSelectedSection(key: string, value: any) {
    const s = this.selection();
    if (!s || s.type !== 'section') return;
    this.mutateActiveSections((sections) => {
      if (s.childSectionIndex !== undefined && s.childSectionIndex >= 0) {
        const parent = {
          ...sections[s.sectionIndex!],
          child_sections: [...sections[s.sectionIndex!].child_sections],
        };
        parent.child_sections[s.childSectionIndex] = {
          ...parent.child_sections[s.childSectionIndex],
          [key]: value,
        };
        sections[s.sectionIndex!] = parent;
      } else {
        sections[s.sectionIndex!] = {
          ...sections[s.sectionIndex!],
          [key]: value,
        };
      }
    });
  }

  // --- Item/Field Management ---

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

  onFieldSelectByValue(parentIndex: number, sectionIndex: number, value: string | number | null) {
    const fieldId = parseInt(String(value), 10);
    if (!fieldId) return;
    if (parentIndex >= 0) {
      this.addFieldToChildSection(parentIndex, sectionIndex, fieldId);
    } else {
      this.addFieldToSection(sectionIndex, fieldId);
    }
  }

  getFieldOptionsForSection(si: number, isChild: boolean, parentIndex: number) {
    return this.getAvailableFieldsForSection(si, isChild, parentIndex).map((f) => ({
      value: String(f.id),
      label: `${f.label} (${f.field_type})`,
    }));
  }

  addFieldToSection(sectionIndex: number, fieldId: number) {
    this.mutateActiveSections((sections) => {
      const section = sections[sectionIndex];
      if (!section.items.find((i) => i.metadata_field_id === fieldId)) {
        sections[sectionIndex] = {
          ...section,
          items: [
            ...section.items,
            {
              metadata_field_id: fieldId,
              sort_order: section.items.length,
              is_required: false,
              include_in_summary: false,
              width: '100',
              icon: '',
              help_text: '',
              placeholder: '',
            },
          ],
        };
      }
    });
  }

  addFieldToChildSection(
    parentIndex: number,
    childIndex: number,
    fieldId: number,
  ) {
    this.mutateActiveSections((sections) => {
      const parent = {
        ...sections[parentIndex],
        child_sections: [...sections[parentIndex].child_sections],
      };
      const child = parent.child_sections[childIndex];
      if (!child.items.find((i) => i.metadata_field_id === fieldId)) {
        parent.child_sections[childIndex] = {
          ...child,
          items: [
            ...child.items,
            {
              metadata_field_id: fieldId,
              sort_order: child.items.length,
              is_required: false,
              include_in_summary: false,
              width: '100',
              icon: '',
              help_text: '',
              placeholder: '',
            },
          ],
        };
        sections[parentIndex] = parent;
      }
    });
  }

  removeFieldFromSection(sectionIndex: number, itemIndex: number) {
    this.mutateActiveSections((sections) => {
      const section = sections[sectionIndex];
      const items = section.items.filter((_, i) => i !== itemIndex);
      items.forEach((item, i) => (item.sort_order = i));
      sections[sectionIndex] = { ...section, items };
    });
  }

  removeFieldFromChildSection(
    parentIndex: number,
    childIndex: number,
    itemIndex: number,
  ) {
    this.mutateActiveSections((sections) => {
      const parent = {
        ...sections[parentIndex],
        child_sections: [...sections[parentIndex].child_sections],
      };
      const child = parent.child_sections[childIndex];
      const items = child.items.filter((_, i) => i !== itemIndex);
      items.forEach((item, i) => (item.sort_order = i));
      parent.child_sections[childIndex] = { ...child, items };
      sections[parentIndex] = parent;
    });
  }

  updateSelectedItem(key: string, value: any) {
    const s = this.selection();
    if (!s || s.type !== 'item') return;
    this.mutateActiveSections((sections) => {
      if (s.childSectionIndex !== undefined && s.childSectionIndex >= 0) {
        const parent = {
          ...sections[s.sectionIndex!],
          child_sections: [...sections[s.sectionIndex!].child_sections],
        };
        const child = parent.child_sections[s.childSectionIndex];
        const items = [...child.items];
        items[s.itemIndex!] = { ...items[s.itemIndex!], [key]: value };
        parent.child_sections[s.childSectionIndex] = { ...child, items };
        sections[s.sectionIndex!] = parent;
      } else {
        const section = sections[s.sectionIndex!];
        const items = [...section.items];
        items[s.itemIndex!] = { ...items[s.itemIndex!], [key]: value };
        sections[s.sectionIndex!] = { ...section, items };
      }
    });
  }

  // --- Selection ---

  selectSectionElement(si: number, isChild: boolean, parentIndex: number) {
    if (isChild) {
      this.selection.set({
        type: 'section',
        sectionIndex: parentIndex,
        childSectionIndex: si,
      });
    } else {
      this.selection.set({
        type: 'section',
        sectionIndex: si,
        childSectionIndex: -1,
      });
    }
  }

  selectItem(si: number, fi: number, isChild: boolean, parentIndex: number) {
    if (isChild) {
      this.selection.set({
        type: 'item',
        sectionIndex: parentIndex,
        childSectionIndex: si,
        itemIndex: fi,
      });
    } else {
      this.selection.set({
        type: 'item',
        sectionIndex: si,
        childSectionIndex: -1,
        itemIndex: fi,
      });
    }
  }

  isElementSelected(
    type: string,
    si: number,
    isChild: boolean,
    parentIndex: number,
  ): boolean {
    const s = this.selection();
    if (!s || s.type !== type) return false;
    if (isChild) {
      return s.sectionIndex === parentIndex && s.childSectionIndex === si;
    }
    return s.sectionIndex === si && (s.childSectionIndex ?? -1) < 0;
  }

  isItemSelected(
    si: number,
    fi: number,
    isChild: boolean,
    parentIndex: number,
  ): boolean {
    const s = this.selection();
    if (!s || s.type !== 'item') return false;
    if (isChild) {
      return (
        s.sectionIndex === parentIndex &&
        s.childSectionIndex === si &&
        s.itemIndex === fi
      );
    }
    return (
      s.sectionIndex === si &&
      (s.childSectionIndex ?? -1) < 0 &&
      s.itemIndex === fi
    );
  }

  private clearSelectionIfMatches(type: string, index: number) {
    const s = this.selection();
    if (s && s.type === type && s.sectionIndex === index) {
      this.selection.set(null);
    }
  }

  // --- Field Helpers ---

  private getAllUsedFieldIds(): Set<number> {
    const ids = new Set<number>();
    const fd = this.formData();
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
    collectFromSections(fd.sections);
    for (const tab of fd.tabs) {
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

  // --- Product Helpers ---

  getProductName(id: number): string {
    return (
      this.availableProducts().find((p) => p.id === id)?.name ||
      'Producto desconocido'
    );
  }

  getUnselectedProducts(): any[] {
    return this.availableProducts().filter(
      (p) => !this.selectedProductIds().includes(p.id),
    );
  }

  getUnselectedProductOptions() {
    return this.getUnselectedProducts().map((p) => ({
      value: String(p.id),
      label: p.name,
    }));
  }

  onProductSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    const productId = parseInt(select.value, 10);
    if (productId && !this.selectedProductIds().includes(productId)) {
      this.selectedProductIds.update((ids) => [...ids, productId]);
    }
    select.value = '';
  }

  onProductSelectByValue(value: string | number | null) {
    const productId = parseInt(String(value), 10);
    if (productId && !this.selectedProductIds().includes(productId)) {
      this.selectedProductIds.update((ids) => [...ids, productId]);
    }
  }

  removeProduct(id: number) {
    this.selectedProductIds.update((ids) => ids.filter((pid) => pid !== id));
  }

  // --- Data Loading ---

  private loadAvailableFields() {
    this.fieldsService.getFields().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (fields) => this.availableFields.set(fields),
      error: () => {},
    });
  }

  private loadAvailableProducts() {
    this.http
      .get<any>(`${environment.apiUrl}/store/products?limit=200`)
      .pipe(map((r) => r.data))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (products) => this.availableProducts.set(products),
        error: () => {},
      });
  }
}
