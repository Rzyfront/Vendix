import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DynamicFieldComponent } from '../../../../../ecommerce/pages/data-collection-form/components/dynamic-field/dynamic-field.component';
import { IconComponent, SpinnerComponent } from '../../../../../../../shared/components';
import { getItemWidthClass } from '../../../../data-collection/utils/item-width.util';
import { IntakeTemplate, IntakeTemplateItem, ServiceStationsService } from '../service-stations.service';
import {
  buildIntakeEntries,
  flattenIntakeSections,
  isIntakeItemRequired,
  missingRequiredIntakeItems,
  uniqueIntakeItems,
} from './session-intake-form.util';

/** Customer profile defaults by metadata `field_key`. */
export interface IntakeCustomerDefaults {
  nombre_cliente?: string | null;
  numero_documento?: string | null;
  telefono?: string | null;
  correo?: string | null;
}

/**
 * Intake form ("Formulario de recepción") of a service session.
 *
 * Loads the template of the station (or, without one, of the service), prefills it
 * from the customer profile, renders it with `app-dynamic-field` and shows a message
 * next to each empty required field.
 *
 * - `scope`: `all` renders every section; `customer` only the customer-entity fields
 *   (no card); `rest` the sections without customer fields. The admin check-in uses a
 *   `rest` loader plus a `customer` instance (`[loadTemplate]="false"`, same
 *   `[(template)]` and `[(values)]`) so customer fields sit in the customer block.
 * - Read `valid()` / `entries()` from the instance (`viewChild`) to gate the submit
 *   button and build `intake_values`.
 */
@Component({
  selector: 'app-session-intake-form',
  standalone: true,
  imports: [NgTemplateOutlet, DynamicFieldComponent, IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scope() === 'customer') {
      @if (customerItems().length) {
        <div class="flex flex-wrap gap-3">
          @for (item of customerItems(); track item.id) {
            <div [class]="widthClass(item.width)">
              <ng-container *ngTemplateOutlet="field; context: { $implicit: item }" />
            </div>
          }
        </div>
      }
    } @else if (loading()) {
      <div class="rounded-xl border border-[var(--color-border)] p-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <app-spinner size="sm" /> Cargando formulario de recepción...
      </div>
    } @else if (template(); as tpl) {
      @if (visibleSections().length) {
        <div class="rounded-xl border border-[var(--color-border)] p-4 space-y-4">
          <div>
            <h4 class="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
              <app-icon name="clipboard-list" [size]="14" class="text-[var(--color-primary)]" />
              {{ tpl.name || 'Formulario de recepción' }}
            </h4>
            <p class="text-xs text-[var(--color-text-secondary)]">Se guarda con esta atención.</p>
          </div>
          @for (section of visibleSections(); track section.key) {
            <div class="space-y-2">
              @if (visibleSections().length > 1 || section.description) {
                <div>
                  <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">{{ section.title }}</p>
                  @if (section.description) {
                    <p class="text-xs text-[var(--color-text-secondary)]">{{ section.description }}</p>
                  }
                </div>
              }
              <div class="flex flex-wrap gap-3">
                @for (item of section.items; track item.id) {
                  <div [class]="widthClass(item.width)">
                    <ng-container *ngTemplateOutlet="field; context: { $implicit: item }" />
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    }

    <ng-template #field let-item>
      @if (item.metadata_field.field_type === 'file') {
        <p class="text-xs text-[var(--color-text-secondary)]">
          {{ item.metadata_field.label }}: los archivos no se capturan en la recepción.
        </p>
      } @else {
        <app-dynamic-field
          [field]="item.metadata_field"
          [value]="valueOf(item.metadata_field.id)"
          [required]="isRequired(item)"
          [placeholder]="item.placeholder || ''"
          [helpText]="item.help_text || ''"
          [icon]="item.icon || ''"
          (valueChange)="setValue(item.metadata_field.id, $event)"
        />
        @if (missingIds().has(item.metadata_field.id)) {
          <p class="mt-1 text-xs text-[var(--color-error)]" role="alert">
            {{ item.metadata_field.field_type === 'checkbox' ? 'Debes marcar esta casilla para continuar.' : 'Este campo es obligatorio.' }}
          </p>
        }
      }
    </ng-template>
  `,
})
export class SessionIntakeFormComponent {
  private readonly api = inject(ServiceStationsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Service (product) whose template applies when the station has none. */
  readonly productId = input<number | null>(null);
  /** Station: its template wins over the service's. */
  readonly stationId = input<number | null>(null);
  /** Registered customer: prefills the fields from the profile. */
  readonly customerId = input<number | null>(null);
  readonly scope = input<'all' | 'customer' | 'rest'>('all');
  /** `false` = do not fetch: render the `[(template)]` given by another instance. */
  readonly loadTemplate = input<boolean>(true);
  /** Customer data that fills the empty customer fields of the template. */
  readonly customerDefaults = input<IntakeCustomerDefaults | null>(null);

  readonly template = model<IntakeTemplate | null>(null);
  /** Answers by metadata field id (raw, as the fields emit them). */
  readonly values = model<Record<number, unknown>>({});

  /** Emits `true` while the template is being fetched. */
  readonly loadingChange = output<boolean>();

  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();

  private templateSeq = 0;
  private prefillSeq = 0;

  readonly widthClass = getItemWidthClass;

  private readonly sections = computed(() => flattenIntakeSections(this.template()));
  readonly items = computed<IntakeTemplateItem[]>(() => uniqueIntakeItems(this.sections()));
  readonly customerItems = computed(() =>
    this.items().filter((item) => item.metadata_field.entity_type === 'customer'),
  );
  readonly visibleSections = computed(() => {
    const scope = this.scope();
    if (scope === 'all') return this.sections();
    return this.sections()
      .map((s) => ({ ...s, items: s.items.filter((i) => i.metadata_field.entity_type !== 'customer') }))
      .filter((s) => s.items.length > 0);
  });

  private readonly missing = computed(() => missingRequiredIntakeItems(this.items(), this.values()));
  readonly missingIds = computed(() => new Set(this.missing().map((i) => i.metadata_field.id)));
  /** Answers ready for `intake_values` (empty ones omitted). */
  readonly entries = computed(() => buildIntakeEntries(this.items(), this.values()));
  /** `true` once the form loaded and no required field is empty. */
  readonly valid = computed(() => !this._loading() && this.missing().length === 0);

  constructor() {
    effect(() => this.loadingChange.emit(this._loading()));

    effect(() => {
      const productId = this.productId();
      const stationId = this.stationId();
      const load = this.loadTemplate();
      untracked(() => {
        if (!load) {
          this._loading.set(false);
          return;
        }
        this.fetchTemplate(productId, stationId);
      });
    });

    effect(() => {
      const customerId = this.customerId();
      const template = this.template();
      if (!customerId || !template) return;
      untracked(() => this.fetchPrefill(customerId));
    });

    effect(() => {
      const defaults = this.customerDefaults();
      const items = this.items();
      if (!defaults || !items.length) return;
      untracked(() => this.applyDefaults(defaults, items));
    });
  }

  valueOf(fieldId: number): unknown {
    return this.values()[fieldId] ?? '';
  }

  setValue(fieldId: number, value: unknown): void {
    this.values.update((current) => ({ ...current, [fieldId]: value }));
  }

  isRequired(item: IntakeTemplateItem): boolean {
    return isIntakeItemRequired(item);
  }

  private fetchTemplate(productId: number | null, stationId: number | null): void {
    const seq = ++this.templateSeq;
    this.prefillSeq++;
    this.template.set(null);
    this.values.set({});
    // The station's template does not depend on the service: loads as soon as there is a station.
    if (!productId && !stationId) {
      this._loading.set(false);
      return;
    }
    this._loading.set(true);
    this.api
      .getIntakeTemplate(productId || null, stationId || null)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (template) => {
          if (seq !== this.templateSeq) return;
          this.template.set(template);
          this._loading.set(false);
        },
        error: () => {
          if (seq !== this.templateSeq) return;
          this._loading.set(false);
        },
      });
  }

  /** Prefills (without overwriting what was typed) the fields saved on the customer profile. */
  private fetchPrefill(customerId: number): void {
    if (!this.loadTemplate()) return;
    const seq = ++this.prefillSeq;
    this.api
      .getIntakePrefill(this.productId() || null, customerId, this.stationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (entries) => {
          if (seq !== this.prefillSeq || this.customerId() !== customerId) return;
          const known = new Set(this.items().map((item) => item.metadata_field.id));
          this.values.update((values) => {
            const next = { ...values };
            for (const entry of entries) {
              if (!known.has(entry.field_id)) continue;
              const current = next[entry.field_id];
              if (current !== undefined && current !== null && current !== '') continue;
              if (entry.value === undefined || entry.value === null) continue;
              next[entry.field_id] = entry.value;
            }
            return next;
          });
        },
        error: () => {}, // Not critical: the form stays empty
      });
  }

  private applyDefaults(defaults: IntakeCustomerDefaults, items: IntakeTemplateItem[]): void {
    this.values.update((values) => {
      const next = { ...values };
      for (const item of items) {
        const field = item.metadata_field;
        if (field.entity_type !== 'customer') continue;
        const value = (defaults as Record<string, string | null | undefined>)[field.field_key];
        if (value == null || value === '') continue;
        const current = next[field.id];
        if (current === undefined || current === null || current === '') next[field.id] = value;
      }
      return next;
    });
  }
}
