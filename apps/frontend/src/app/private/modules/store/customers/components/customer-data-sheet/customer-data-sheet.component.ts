import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, Subject, catchError, finalize, merge, switchMap, tap } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SpinnerComponent,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { getItemWidth } from '../../../data-collection/utils/item-width.util';
import type {
  MetadataField,
  FieldType,
} from '../../../data-collection/interfaces/metadata-field.interface';
import type {
  TemplateItem,
  TemplateSection,
} from '../../../data-collection/interfaces/data-collection-template.interface';
import { CustomerDataSheetService } from '../../services/customer-data-sheet.service';
import type {
  CustomerDataSheet,
  DataSheetValue,
  DataSheetValueInput,
} from './customer-data-sheet.interface';

type DraftValue = string | boolean;

interface ViewItem {
  item: TemplateItem;
  field: MetadataField;
  type: FieldType;
  options: SelectorOption[];
}

interface ViewSection {
  id: number;
  title: string;
  icon: string | null;
  items: ViewItem[];
  children: ViewSection[];
}

interface ViewTab {
  id: number;
  title: string;
  sections: ViewSection[];
}

interface FileInfo {
  url: string;
  name: string;
}

const DEFAULT_SENTINEL = 'default';

const bySort = <T extends { sort_order: number }>(a: T, b: T) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0);

/** Accepts `string[]`, `{value,label}[]` or `{ options|choices: [...] }`. */
function toSelectOptions(raw: unknown): SelectorOption[] {
  if (Array.isArray(raw)) {
    return raw.map((o) => {
      if (o !== null && typeof o === 'object') {
        const rec = o as Record<string, unknown>;
        const value = String(rec['value'] ?? rec['label'] ?? '');
        return { value, label: String(rec['label'] ?? value) };
      }
      return { value: String(o), label: String(o) };
    });
  }
  if (raw !== null && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    return toSelectOptions(rec['options'] ?? rec['choices'] ?? []);
  }
  return [];
}

function buildSection(section: TemplateSection): ViewSection {
  return {
    id: section.id,
    title: section.title,
    icon: section.icon ?? null,
    items: [...(section.items ?? [])]
      .sort(bySort)
      .filter((item) => !!item.metadata_field)
      .map((item) => ({
        item,
        field: item.metadata_field,
        type: item.metadata_field.field_type,
        options: toSelectOptions(item.metadata_field.options),
      })),
    children: [...(section.child_sections ?? [])].sort(bySort).map(buildSection),
  };
}

/** Value shown by a control before any edit. */
function originalControlValue(
  value: DataSheetValue | undefined,
  type: FieldType,
): DraftValue {
  if (type === 'checkbox') return value?.value_bool ?? false;
  if (type === 'number') return value?.value_number ?? '';
  if (type === 'date') return (value?.value_date ?? '').slice(0, 10);
  return value?.value_text ?? '';
}

/**
 * Customer data sheet: the customer's answers to its effective Data Collection
 * template (chosen template, or the CRM default). Shared by the customer detail
 * and the pipeline opportunity detail.
 */
@Component({
  selector: 'app-customer-data-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    SpinnerComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  host: { class: 'block' },
  styles: [
    `
      .ds-item {
        min-width: min(100%, 12rem);
        max-width: 100%;
      }
    `,
  ],
  template: `
    <ng-template #body>
      @if (loading()) {
        <div class="flex justify-center py-8">
          <app-spinner size="md" text="Cargando ficha..."></app-spinner>
        </div>
      } @else if (loadError()) {
        <app-empty-state
          size="sm"
          icon="alert-circle"
          title="No se pudo cargar la ficha"
          [description]="loadError()!"
          actionButtonText="Reintentar"
          actionButtonIcon="refresh-cw"
          (actionClick)="retry()"
        ></app-empty-state>
      } @else if (sheet(); as data) {
        <div class="space-y-4">
          <!-- Template picker / effective template name -->
          @if (editable() && data.templates.length > 0) {
            <app-selector
              label="Plantilla de datos"
              size="sm"
              [options]="templateOptions()"
              [value]="selectedTemplateValue()"
              [disabled]="switchingTemplate() || hasChanges() || saving()"
              [helpText]="hasChanges() ? 'Guarda o descarta los cambios antes de cambiar de plantilla.' : ''"
              (valueChange)="onTemplateChange($event)"
            ></app-selector>
          } @else if (data.template) {
            <p class="text-xs text-text-secondary">
              Plantilla:
              <span class="font-semibold text-text-primary">{{ data.template.name }}</span>
            </p>
          }

          @if (!data.template) {
            <app-empty-state
              size="sm"
              icon="clipboard-list"
              title="Sin plantilla de datos"
              description="Crea una plantilla de tipo Cliente en Recolección de datos y márcala como predeterminada del CRM."
              [showActionButton]="false"
            ></app-empty-state>
          } @else {
            @if (view().tabs.length > 0) {
              <div
                class="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-secondary p-1"
                role="tablist"
              >
                @for (tab of view().tabs; track tab.id) {
                  <button
                    type="button"
                    role="tab"
                    class="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                    [class.bg-surface]="currentTab()?.id === tab.id"
                    [class.text-primary]="currentTab()?.id === tab.id"
                    [class.shadow-sm]="currentTab()?.id === tab.id"
                    [class.text-text-secondary]="currentTab()?.id !== tab.id"
                    [attr.aria-selected]="currentTab()?.id === tab.id"
                    (click)="activeTabId.set(tab.id)"
                  >
                    {{ tab.title }}
                  </button>
                }
              </div>
              @for (section of currentTab()?.sections ?? []; track section.id) {
                <ng-container
                  *ngTemplateOutlet="sectionTpl; context: { $implicit: section, depth: 0 }"
                ></ng-container>
              }
            }
            @for (section of view().sections; track section.id) {
              <ng-container
                *ngTemplateOutlet="sectionTpl; context: { $implicit: section, depth: 0 }"
              ></ng-container>
            }
          }

          @if (editable() && data.template) {
            <div class="flex flex-wrap items-center justify-end gap-2">
              @if (hasChanges()) {
                <app-button variant="ghost" size="sm" [disabled]="saving()" (clicked)="discard()">
                  Descartar
                </app-button>
              }
              <app-button
                variant="primary"
                size="sm"
                [disabled]="!hasChanges() || saving() || uploadingCount() > 0"
                [loading]="saving()"
                (clicked)="save()"
              >
                <app-icon name="save" [size]="14" slot="icon"></app-icon>
                Guardar ficha
              </app-button>
            </div>
          }

          @if (data.other_values.length > 0) {
            <div class="rounded-xl border border-border">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold text-text-primary"
                [attr.aria-expanded]="otherOpen()"
                (click)="otherOpen.set(!otherOpen())"
              >
                <span>Otros datos del cliente ({{ data.other_values.length }})</span>
                <app-icon [name]="otherOpen() ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
              </button>
              @if (otherOpen()) {
                <div class="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
                  @for (v of data.other_values; track v.field_id) {
                    <div class="flex min-w-0 flex-col">
                      <span class="text-xs text-text-secondary">{{ v.label }}</span>
                      @if (v.field_type === 'file' && v.file_url) {
                        <a
                          class="text-sm font-semibold text-primary hover:underline"
                          [href]="v.file_url"
                          target="_blank"
                          rel="noopener noreferrer"
                          >Ver adjunto</a
                        >
                      } @else {
                        <span class="break-words text-sm text-text-primary">{{ displayValue(v) }}</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </ng-template>

    <ng-template #sectionTpl let-section let-depth="depth">
      <div class="space-y-3" [class.ml-3]="depth > 0">
        <h4 class="flex items-center gap-2 text-sm font-semibold text-text-primary">
          @if (section.icon) {
            <app-icon [name]="section.icon" [size]="14" class="text-primary"></app-icon>
          }
          {{ section.title }}
        </h4>
        <div class="flex flex-wrap gap-3">
          @for (vi of section.items; track vi.item.id) {
            <div class="ds-item" [style.width]="itemWidth(vi.item)">
              <ng-container *ngTemplateOutlet="itemTpl; context: { $implicit: vi }"></ng-container>
            </div>
          }
        </div>
        @for (child of section.children; track child.id) {
          <ng-container
            *ngTemplateOutlet="sectionTpl; context: { $implicit: child, depth: depth + 1 }"
          ></ng-container>
        }
      </div>
    </ng-template>

    <ng-template #itemTpl let-vi>
      @if (!editable()) {
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-text-secondary">{{ vi.field.label }}</span>
          @if (vi.type === 'file') {
            @if (fileLink(vi); as link) {
              <a
                class="text-sm font-semibold text-primary hover:underline"
                [href]="link.url"
                target="_blank"
                rel="noopener noreferrer"
                >Ver adjunto</a
              >
            } @else {
              <span class="text-sm text-text-primary">—</span>
            }
          } @else {
            <span class="break-words text-sm text-text-primary">{{ readText(vi) }}</span>
          }
        </div>
      } @else {
        @switch (vi.type) {
          @case ('textarea') {
            <app-textarea
              [label]="vi.field.label"
              [required]="vi.item.is_required"
              [placeholder]="vi.item.placeholder ?? ''"
              [helperText]="vi.item.help_text ?? undefined"
              [ngModel]="textValue(vi)"
              (ngModelChange)="onText(vi, $event)"
            ></app-textarea>
          }
          @case ('select') {
            <app-selector
              [label]="vi.field.label"
              [required]="vi.item.is_required"
              [placeholder]="vi.item.placeholder || 'Selecciona una opción'"
              [helpText]="vi.item.help_text ?? ''"
              [options]="vi.options"
              [value]="textValue(vi)"
              (valueChange)="onText(vi, $event === null ? '' : '' + $event)"
            ></app-selector>
          }
          @case ('checkbox') {
            <div class="flex flex-col gap-1">
              <app-toggle
                [label]="vi.field.label + (vi.item.is_required ? ' *' : '')"
                [checked]="boolValue(vi)"
                (toggled)="onBool(vi, $event)"
              ></app-toggle>
              @if (vi.item.help_text) {
                <span class="text-xs text-text-secondary">{{ vi.item.help_text }}</span>
              }
            </div>
          }
          @case ('file') {
            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-text-primary">
                {{ vi.field.label }}
                @if (vi.item.is_required) {
                  <span class="text-error">*</span>
                }
              </span>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  #fileInput
                  type="file"
                  class="hidden"
                  accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  (change)="onFileSelected(vi, fileInput)"
                />
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="isUploading(vi)"
                  [loading]="isUploading(vi)"
                  (clicked)="fileInput.click()"
                >
                  <app-icon name="upload" [size]="14" slot="icon"></app-icon>
                  {{ fileLink(vi) ? 'Reemplazar' : 'Subir archivo' }}
                </app-button>
                @if (fileLink(vi); as link) {
                  <a
                    class="text-sm font-semibold text-primary hover:underline"
                    [href]="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Ver adjunto</a
                  >
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-error"
                    (click)="removeFile(vi)"
                  >
                    <app-icon name="x" [size]="12"></app-icon>
                    Quitar
                  </button>
                }
              </div>
              @if (uploadErrors()[vi.field.id]; as err) {
                <span class="text-xs text-error">{{ err }}</span>
              } @else if (vi.item.help_text) {
                <span class="text-xs text-text-secondary">{{ vi.item.help_text }}</span>
              }
            </div>
          }
          @default {
            <app-input
              [label]="vi.field.label"
              [required]="vi.item.is_required"
              [type]="inputType(vi.type)"
              [placeholder]="vi.item.placeholder ?? ''"
              [helperText]="vi.item.help_text ?? ''"
              [ngModel]="textValue(vi)"
              (ngModelChange)="onText(vi, $event)"
            ></app-input>
          }
        }
      }
    </ng-template>

    @if (compact()) {
      <ng-container *ngTemplateOutlet="body"></ng-container>
    } @else {
      <app-card title="Ficha del cliente">
        <ng-container *ngTemplateOutlet="body"></ng-container>
      </app-card>
    }
  `,
})
export class CustomerDataSheetComponent {
  private readonly service = inject(CustomerDataSheetService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerId = input.required<number>();
  readonly editable = input<boolean>(false);
  readonly compact = input<boolean>(false);
  readonly saved = output<void>();

  readonly sheet = signal<CustomerDataSheet | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly switchingTemplate = signal(false);
  /**
   * "Otros datos" starts open when there is no template: before QUI-1043 the
   * profile showed these answers directly, so they must not hide by default.
   */
  readonly otherOpen = linkedSignal({
    source: () => !this.sheet()?.template,
    computation: (noTemplate: boolean) => noTemplate,
  });
  readonly activeTabId = signal<number | null>(null);

  /** Changed controls only, keyed by field id. */
  private readonly draft = signal<Record<number, DraftValue>>({});
  private readonly fileInfo = signal<Record<number, FileInfo>>({});
  private readonly uploading = signal<Record<number, boolean>>({});
  readonly uploadErrors = signal<Record<number, string>>({});

  private readonly retry$ = new Subject<void>();

  readonly hasChanges = computed(() => Object.keys(this.draft()).length > 0);
  readonly uploadingCount = computed(
    () => Object.values(this.uploading()).filter(Boolean).length,
  );

  private readonly valuesById = computed(() => {
    const map = new Map<number, DataSheetValue>();
    for (const v of this.sheet()?.values ?? []) map.set(v.field_id, v);
    return map;
  });

  readonly view = computed<{ tabs: ViewTab[]; sections: ViewSection[] }>(() => {
    const tpl = this.sheet()?.template;
    if (!tpl) return { tabs: [], sections: [] };
    const tabs = [...(tpl.tabs ?? [])].sort(bySort).map((t) => ({
      id: t.id,
      title: t.title,
      sections: [...(t.sections ?? [])].sort(bySort).map(buildSection),
    }));
    const loose = [...(tpl.sections ?? [])]
      .filter((s) => tabs.length === 0 || !s.tab_id)
      .sort(bySort)
      .map(buildSection);
    return { tabs, sections: loose };
  });

  readonly currentTab = computed(() => {
    const tabs = this.view().tabs;
    return tabs.find((t) => t.id === this.activeTabId()) ?? tabs[0] ?? null;
  });

  private readonly itemsByFieldId = computed(() => {
    const map = new Map<number, ViewItem>();
    const walk = (s: ViewSection) => {
      s.items.forEach((vi) => map.set(vi.field.id, vi));
      s.children.forEach(walk);
    };
    const v = this.view();
    v.tabs.forEach((t) => t.sections.forEach(walk));
    v.sections.forEach(walk);
    return map;
  });

  readonly templateOptions = computed<SelectorOption[]>(() => {
    const data = this.sheet();
    if (!data) return [];
    const def = data.templates.find((t) => t.id === data.default_template_id);
    return [
      {
        value: DEFAULT_SENTINEL,
        label: def ? `Predeterminada (${def.name})` : 'Predeterminada',
      },
      ...data.templates.map((t) => ({ value: t.id, label: t.name })),
    ];
  });

  readonly selectedTemplateValue = computed<string | number>(
    () => this.sheet()?.selected_template_id ?? DEFAULT_SENTINEL,
  );

  constructor() {
    merge(
      toObservable(this.customerId),
      this.retry$.pipe(switchMap(() => [this.customerId()])),
    )
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
          this.sheet.set(null);
          this.resetEdits();
        }),
        switchMap((id) =>
          this.service.get(id).pipe(
            catchError((err) => {
              this.loadError.set(parseApiError(err).userMessage);
              return EMPTY;
            }),
            finalize(() => this.loading.set(false)),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => this.sheet.set(data));
  }

  retry(): void {
    this.retry$.next();
  }

  itemWidth(item: TemplateItem): string {
    return getItemWidth(item.width);
  }

  inputType(type: FieldType): 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' {
    switch (type) {
      case 'email':
        return 'email';
      case 'phone':
        return 'tel';
      case 'url':
        return 'url';
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      default:
        return 'text';
    }
  }

  // ---- values (draft over server) ----

  private currentValue(vi: ViewItem): DraftValue {
    const d = this.draft()[vi.field.id];
    return d !== undefined
      ? d
      : originalControlValue(this.valuesById().get(vi.field.id), vi.type);
  }

  textValue(vi: ViewItem): string {
    const v = this.currentValue(vi);
    return typeof v === 'string' ? v : '';
  }

  boolValue(vi: ViewItem): boolean {
    return this.currentValue(vi) === true;
  }

  private setDraft(vi: ViewItem, value: DraftValue): void {
    const original = originalControlValue(this.valuesById().get(vi.field.id), vi.type);
    this.draft.update((d) => {
      const next = { ...d };
      if (value === original) delete next[vi.field.id];
      else next[vi.field.id] = value;
      return next;
    });
  }

  onText(vi: ViewItem, value: string | null): void {
    this.setDraft(vi, value ?? '');
  }

  onBool(vi: ViewItem, value: boolean): void {
    this.setDraft(vi, value);
  }

  // ---- read-only text ----

  displayValue(v: DataSheetValue): string {
    switch (v.field_type) {
      case 'checkbox':
        return v.value_bool === null ? '—' : v.value_bool ? 'Sí' : 'No';
      case 'number':
        return v.value_number ?? '—';
      case 'date':
        return v.value_date ? formatDateOnlyUTC(v.value_date.slice(0, 10)) : '—';
      default:
        return v.value_text?.trim() ? v.value_text : '—';
    }
  }

  readText(vi: ViewItem): string {
    const v = this.valuesById().get(vi.field.id);
    return v ? this.displayValue(v) : '—';
  }

  // ---- files ----

  fileLink(vi: ViewItem): FileInfo | null {
    const id = vi.field.id;
    const d = this.draft()[id];
    if (d !== undefined) {
      return d === '' ? null : (this.fileInfo()[id] ?? null);
    }
    const url = this.valuesById().get(id)?.file_url;
    return url ? { url, name: 'Ver adjunto' } : null;
  }

  isUploading(vi: ViewItem): boolean {
    return !!this.uploading()[vi.field.id];
  }

  onFileSelected(vi: ViewItem, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const id = vi.field.id;
    this.uploading.update((u) => ({ ...u, [id]: true }));
    this.uploadErrors.update(({ [id]: _drop, ...rest }) => rest);
    this.service
      .upload(this.customerId(), file)
      .pipe(
        finalize(() => this.uploading.update((u) => ({ ...u, [id]: false }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.fileInfo.update((f) => ({
            ...f,
            [id]: { url: res.url, name: res.original_name },
          }));
          this.setDraft(vi, res.key);
        },
        error: (err) =>
          this.uploadErrors.update((e) => ({
            ...e,
            [id]: parseApiError(err).userMessage,
          })),
      });
  }

  removeFile(vi: ViewItem): void {
    this.setDraft(vi, '');
  }

  // ---- actions ----

  discard(): void {
    this.resetEdits();
  }

  private resetEdits(): void {
    this.draft.set({});
    this.fileInfo.set({});
    this.uploading.set({});
    this.uploadErrors.set({});
  }

  onTemplateChange(value: string | number | null): void {
    const templateId = typeof value === 'number' ? value : null;
    if (templateId === (this.sheet()?.selected_template_id ?? null)) return;
    this.switchingTemplate.set(true);
    this.service
      .setTemplate(this.customerId(), templateId)
      .pipe(
        finalize(() => this.switchingTemplate.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.resetEdits();
          this.sheet.set(data);
        },
        error: (err) => this.toast.error(parseApiError(err).userMessage),
      });
  }

  private buildPayload(): DataSheetValueInput[] {
    const items = this.itemsByFieldId();
    const payload: DataSheetValueInput[] = [];
    for (const [key, raw] of Object.entries(this.draft())) {
      const fieldId = Number(key);
      const vi = items.get(fieldId);
      if (!vi) continue;
      const entry: DataSheetValueInput = {
        field_id: fieldId,
        value_text: null,
        value_number: null,
        value_date: null,
        value_bool: null,
        value_json: null,
      };
      if (vi.type === 'checkbox') {
        entry.value_bool = raw === true;
      } else if (vi.type === 'number') {
        const n = typeof raw === 'string' && raw !== '' ? Number(raw) : NaN;
        entry.value_number = Number.isFinite(n) ? n : null;
      } else if (vi.type === 'date') {
        entry.value_date = typeof raw === 'string' && raw ? raw : null;
      } else {
        entry.value_text = typeof raw === 'string' && raw.trim() ? raw : null;
      }
      payload.push(entry);
    }
    return payload;
  }

  save(): void {
    const values = this.buildPayload();
    if (values.length === 0 || this.saving()) return;
    this.saving.set(true);
    this.service
      .saveValues(this.customerId(), values)
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.resetEdits();
          this.sheet.set(data);
          this.toast.success('Ficha guardada');
          this.saved.emit();
        },
        error: (err) => this.toast.error(parseApiError(err).userMessage),
      });
  }
}
