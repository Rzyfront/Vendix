import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SelectorComponent,
  StickyHeaderComponent,
  TextareaComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { toWorkflowError } from '../../../utils/workflow-errors.util';
import {
  CollectionBody,
  CollectionView,
  RecordFieldDef,
  RecordFieldType,
} from '../../interfaces/records.interfaces';
import { RecordsApiService } from '../../services/records-api.service';
import {
  COLLECTION_ICON_OPTIONS,
  RECORD_FIELD_TYPE_OPTIONS,
  keyFromLabel,
  prefixFromName,
} from '../../utils/records-ui.util';

const MAX_FIELDS = 50;
const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;
const PREFIX_PATTERN = /^[A-Z]{2,6}$/;

interface FieldRow {
  uid: number;
  key: string;
  /** Saved fields keep their key (published flows point at it); new ones follow the label. */
  saved: boolean;
  keyTouched: boolean;
  label: string;
  type: RecordFieldType;
  required: boolean;
  /** One option per line (select only). */
  optionsText: string;
  /** Values of the options already saved, to keep them when a label stays. */
  knownOptions: { value: string; label: string }[];
}

/** `/admin/workflows/records/collections/new` and `.../:collectionId/edit`. */
@Component({
  selector: 'app-collection-designer-page',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    StickyHeaderComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="editing() ? 'Diseñar ' + name() : 'Nueva colección'"
        subtitle="Define el nombre, los campos y cómo se numeran sus registros"
        icon="folder-open"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="backRoute()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      @if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ loadError() }}</app-alert-banner>
      } @else if (loading()) {
        <p class="py-8 text-center text-sm text-text-secondary" role="status">Cargando colección...</p>
      } @else {
        <div class="flex flex-col gap-3 p-2 md:gap-4 md:p-4">
          @if (formError()) {
            <app-alert-banner variant="danger" icon="alert-circle" data-testid="form-error">
              {{ formError() }}
            </app-alert-banner>
          }

          <app-card [responsive]="true">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <app-input
                label="Nombre de la colección"
                placeholder="Ej. Contratos"
                [required]="true"
                [error]="errorOf('name')"
                [ngModel]="name()"
                (ngModelChange)="onName($event)"
              />
              <app-input
                label="Nombre de cada elemento"
                placeholder="Ej. Contrato"
                helperText="Se usa en «Nuevo contrato»."
                [required]="true"
                [error]="errorOf('item_name')"
                [ngModel]="itemName()"
                (ngModelChange)="itemName.set($event ?? '')"
              />
              <app-input
                label="Clave"
                placeholder="contratos"
                [helperText]="editing() ? 'La clave no se puede cambiar: los flujos publicados apuntan a ella.' : 'Letras minúsculas, números, guion o guion bajo. No se podrá cambiar.'"
                [readonly]="editing()"
                [required]="true"
                [error]="errorOf('key')"
                [ngModel]="key()"
                (ngModelChange)="onKey($event)"
              />
              <app-input
                label="Prefijo de la referencia"
                placeholder="CON"
                helperText="De 2 a 6 letras mayúsculas. Ej. CON-000001."
                [error]="errorOf('reference_prefix')"
                [ngModel]="prefix()"
                (ngModelChange)="onPrefix($event)"
              />
              <app-selector
                label="Icono"
                [options]="iconOptions"
                [value]="icon()"
                (valueChange)="icon.set(String($event ?? 'folder-open'))"
              />
              <app-selector
                label="Campo que sirve de título"
                helpText="Por defecto el título es la referencia."
                [options]="titleOptions()"
                [value]="titleField()"
                (valueChange)="titleField.set(String($event ?? ''))"
              />
              <div class="md:col-span-2">
                <app-textarea
                  label="Descripción"
                  placeholder="Para qué sirve esta colección (opcional)"
                  [rows]="2"
                  [ngModel]="description()"
                  (ngModelChange)="description.set($event ?? '')"
                />
              </div>
            </div>
          </app-card>

          <app-card [responsive]="true">
            <div class="flex flex-col gap-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h2 class="text-sm font-bold text-text-primary">Campos</h2>
                  <p class="text-xs text-text-secondary">
                    Los datos que guarda cada elemento. Hasta {{ maxFields }} campos.
                  </p>
                </div>
                <app-button variant="outline" size="sm" [disabled]="rows().length >= maxFields" (clicked)="addField()">
                  <app-icon name="plus" [size]="14" slot="icon" />
                  Agregar campo
                </app-button>
              </div>
              @if (errorOf('fields')) {
                <p class="text-sm text-error" role="alert">{{ errorOf('fields') }}</p>
              }

              @for (row of rows(); track row.uid; let i = $index) {
                <div
                  class="flex flex-col gap-3 rounded-xl border border-border bg-background p-3"
                  data-testid="field-row"
                >
                  <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <app-input
                      label="Nombre del campo"
                      placeholder="Ej. Vence"
                      [required]="true"
                      [error]="errorOf('fields[' + i + '].label')"
                      [ngModel]="row.label"
                      (ngModelChange)="onFieldLabel(row.uid, $event)"
                    />
                    <app-input
                      label="Clave del campo"
                      [readonly]="row.saved"
                      [error]="errorOf('fields[' + i + '].key')"
                      [ngModel]="row.key"
                      (ngModelChange)="onFieldKey(row.uid, $event)"
                    />
                    <app-selector
                      label="Tipo"
                      [options]="typeOptions"
                      [value]="row.type"
                      (valueChange)="patchRow(row.uid, { type: toType($event) })"
                    />
                  </div>
                  @if (row.type === 'select') {
                    <app-textarea
                      label="Opciones (una por línea)"
                      placeholder="Activo&#10;En renovación&#10;Vencido"
                      [rows]="3"
                      [error]="errorOf('fields[' + i + '].options')"
                      [ngModel]="row.optionsText"
                      (ngModelChange)="patchRow(row.uid, { optionsText: $event ?? '' })"
                    />
                  }
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <app-toggle
                      label="Obligatorio"
                      [checked]="row.required"
                      (toggled)="patchRow(row.uid, { required: $event })"
                    />
                    <div class="flex gap-2">
                      <app-button variant="outline" size="xsm" ariaLabel="Subir campo" [disabled]="i === 0" (clicked)="move(i, -1)">
                        <app-icon name="chevron-up" [size]="12" slot="icon" />
                      </app-button>
                      <app-button variant="outline" size="xsm" ariaLabel="Bajar campo" [disabled]="i === rows().length - 1" (clicked)="move(i, 1)">
                        <app-icon name="chevron-down" [size]="12" slot="icon" />
                      </app-button>
                      <app-button variant="outline-danger" size="xsm" ariaLabel="Quitar campo" (clicked)="removeField(row.uid)">
                        <app-icon name="trash-2" [size]="12" slot="icon" />
                      </app-button>
                    </div>
                  </div>
                </div>
              } @empty {
                <p class="text-sm text-text-secondary">Aún no hay campos. Agrega el primero.</p>
              }
            </div>
          </app-card>
        </div>
      }
    </div>
  `,
})
export class CollectionDesignerPageComponent implements OnInit {
  private readonly api = inject(RecordsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly String = String;
  readonly maxFields = MAX_FIELDS;
  readonly typeOptions = RECORD_FIELD_TYPE_OPTIONS;
  readonly iconOptions = COLLECTION_ICON_OPTIONS;

  readonly collectionId = signal<number | null>(null);
  readonly editing = computed(() => this.collectionId() !== null);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly formError = signal('');
  readonly saving = signal(false);
  /** Per-path messages from the API (`fields[1].key` -> text). */
  readonly fieldErrors = signal<Record<string, string>>({});

  readonly name = signal('');
  readonly itemName = signal('');
  readonly key = signal('');
  readonly prefix = signal('');
  readonly icon = signal('folder-open');
  readonly description = signal('');
  readonly titleField = signal('');
  readonly rows = signal<FieldRow[]>([]);
  private keyTouched = false;
  private prefixTouched = false;
  private nextUid = 1;

  readonly backRoute = computed(() =>
    this.editing()
      ? `/admin/workflows/records/collections/${this.collectionId()}`
      : '/admin/workflows/records',
  );

  readonly titleOptions = computed(() => [
    { value: '', label: 'Automático (la referencia)' },
    ...this.rows()
      .filter((r) => r.type === 'text' && KEY_PATTERN.test(r.key))
      .map((r) => ({ value: r.key, label: r.label || r.key })),
  ]);

  readonly headerActions = computed(() => [
    ...(this.editing()
      ? [{ id: 'archive', label: 'Archivar', icon: 'archive', variant: 'outline' as const }]
      : []),
    {
      id: 'save',
      label: this.saving() ? 'Guardando...' : 'Guardar',
      icon: 'save',
      variant: 'primary' as const,
      disabled: this.saving(),
    },
  ]);

  ngOnInit(): void {
    const raw = this.route.snapshot.paramMap.get('collectionId');
    if (raw === null) {
      this.addField();
      return;
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) {
      this.loadError.set('No se encontró la colección.');
      return;
    }
    this.collectionId.set(id);
    this.loading.set(true);
    this.api
      .getCollection(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.fill(c);
          this.loading.set(false);
        },
        error: (error) => {
          this.loadError.set(toWorkflowError(error).message);
          this.loading.set(false);
        },
      });
  }

  errorOf(path: string): string | undefined {
    return this.fieldErrors()[path];
  }

  toType(value: unknown): RecordFieldType {
    return (RECORD_FIELD_TYPE_OPTIONS.find((o) => o.value === value)?.value ?? 'text') as RecordFieldType;
  }

  onName(value: string | null): void {
    const name = value ?? '';
    this.name.set(name);
    if (!this.editing() && !this.keyTouched) this.key.set(keyFromLabel(name));
    if (!this.prefixTouched) this.prefix.set(prefixFromName(name));
  }

  onKey(value: string | null): void {
    this.keyTouched = true;
    this.key.set((value ?? '').toLowerCase());
  }

  onPrefix(value: string | null): void {
    this.prefixTouched = true;
    this.prefix.set((value ?? '').toUpperCase());
  }

  addField(): void {
    this.rows.update((rows) => [
      ...rows,
      {
        uid: this.nextUid++,
        key: '',
        saved: false,
        keyTouched: false,
        label: '',
        type: 'text',
        required: false,
        optionsText: '',
        knownOptions: [],
      },
    ]);
  }

  removeField(uid: number): void {
    this.rows.update((rows) => rows.filter((r) => r.uid !== uid));
  }

  move(index: number, delta: -1 | 1): void {
    this.rows.update((rows) => {
      const target = index + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  patchRow(uid: number, patch: Partial<FieldRow>): void {
    this.rows.update((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }

  onFieldLabel(uid: number, value: string | null): void {
    const label = value ?? '';
    const row = this.rows().find((r) => r.uid === uid);
    if (!row) return;
    this.patchRow(uid, !row.saved && !row.keyTouched ? { label, key: keyFromLabel(label) } : { label });
  }

  onFieldKey(uid: number, value: string | null): void {
    this.patchRow(uid, { key: (value ?? '').toLowerCase(), keyTouched: true });
  }

  onHeaderAction(id: string): void {
    if (id === 'save') this.save();
    if (id === 'archive') void this.archive();
  }

  save(): void {
    if (this.saving()) return;
    const errors = this.validate();
    this.fieldErrors.set(errors);
    this.formError.set('');
    if (Object.keys(errors).length > 0) {
      this.formError.set('Revisa los campos marcados antes de guardar.');
      return;
    }
    const body: CollectionBody = {
      name: this.name().trim(),
      item_name: this.itemName().trim(),
      description: this.description().trim(),
      icon: this.icon(),
      fields: this.rows().map((r) => this.toDef(r)),
      title_field: this.titleField(),
      ...(this.prefix() ? { reference_prefix: this.prefix() } : {}),
    };
    this.saving.set(true);
    const id = this.collectionId();
    const request = id === null
      ? this.api.createCollection({ ...body, key: this.key().trim() })
      : this.api.updateCollection(id, body);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.toast.success(id === null ? 'Colección creada' : 'Colección actualizada');
        this.router.navigate(['/admin/workflows/records/collections', saved.id]);
      },
      error: (error) => {
        this.saving.set(false);
        const parsed = toWorkflowError(error);
        const issues = (parsed.details as { errors?: { field: string; message: string }[] } | null)?.errors;
        if (issues?.length) {
          this.fieldErrors.set(Object.fromEntries(issues.map((i) => [i.field, i.message])));
        }
        this.formError.set(parsed.message);
      },
    });
  }

  async archive(): Promise<void> {
    const id = this.collectionId();
    if (id === null) return;
    const confirmed = await this.dialog.confirm({
      title: 'Archivar colección',
      message: `¿Archivar "${this.name()}"? Sus registros se conservan, pero no podrás crear otros nuevos ni publicar flujos sobre ella.`,
      confirmText: 'Archivar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .archiveCollection(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Colección archivada');
          this.router.navigate(['/admin/workflows/records']);
        },
        error: (error) => this.toast.error(toWorkflowError(error).message),
      });
  }

  // ---- internals ---------------------------------------------------------

  private fill(c: CollectionView): void {
    this.name.set(c.name);
    this.itemName.set(c.item_name);
    this.key.set(c.key);
    this.prefix.set(c.reference_prefix);
    this.prefixTouched = true;
    this.icon.set(c.icon || 'folder-open');
    this.description.set(c.description ?? '');
    this.titleField.set(c.title_field ?? '');
    this.rows.set(
      c.fields.map((f) => ({
        uid: this.nextUid++,
        key: f.key,
        saved: true,
        keyTouched: true,
        label: f.label,
        type: f.type,
        required: f.required === true,
        optionsText: (f.options ?? []).map((o) => o.label).join('\n'),
        knownOptions: f.options ?? [],
      })),
    );
  }

  private toDef(r: FieldRow): RecordFieldDef {
    const def: RecordFieldDef = { key: r.key.trim(), label: r.label.trim(), type: r.type };
    if (r.required) def.required = true;
    if (r.type === 'select') {
      const used = new Set<string>();
      def.options = r.optionsText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((label) => {
          let value = r.knownOptions.find((o) => o.label === label)?.value ?? (keyFromLabel(label) || label);
          while (used.has(value)) value = `${value}_2`;
          used.add(value);
          return { value, label };
        });
    }
    return def;
  }

  /** Quick checks so the person sees what is missing; the API re-validates everything. */
  private validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.name().trim()) errors['name'] = 'Escribe el nombre de la colección.';
    if (!this.itemName().trim()) errors['item_name'] = 'Escribe el nombre de cada elemento.';
    if (!this.editing() && !KEY_PATTERN.test(this.key())) {
      errors['key'] = 'La clave empieza con una letra minúscula y usa solo minúsculas, números, guion o guion bajo.';
    }
    if (this.prefix() && !PREFIX_PATTERN.test(this.prefix())) {
      errors['reference_prefix'] = 'El prefijo son de 2 a 6 letras mayúsculas.';
    }
    if (this.rows().length === 0) errors['fields'] = 'Agrega al menos un campo.';
    const seen = new Set<string>();
    this.rows().forEach((r, i) => {
      if (!r.label.trim()) errors[`fields[${i}].label`] = 'Escribe el nombre del campo.';
      if (!KEY_PATTERN.test(r.key)) {
        errors[`fields[${i}].key`] = 'Clave no válida: minúsculas, números, guion o guion bajo.';
      } else if (seen.has(r.key)) {
        errors[`fields[${i}].key`] = 'Esta clave está repetida.';
      }
      seen.add(r.key);
      if (r.type === 'select' && !r.optionsText.split('\n').some((l) => l.trim())) {
        errors[`fields[${i}].options`] = 'Escribe al menos una opción.';
      }
    });
    return errors;
  }
}
