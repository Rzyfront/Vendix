import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  ConfirmationModalComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  TooltipComponent,
} from '../../../../shared/components/index';
import type { BadgeVariant } from '../../../../shared/components/index';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { formatDateOnlyUTC } from '../../../../shared/utils/date.util';
import {
  CreateFiscalRuleSetPayload,
  FiscalApiScope,
  FiscalRuleSetDetail,
  UpdateFiscalRuleSetPayload,
} from '../interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../services/fiscal-operations.service';

/**
 * Tipos de regla conocidos — espejo de `defaultColombiaRules()` del backend
 * (fiscal-rules.service.ts). Las keys de cada `rules` JSON son las reales
 * que consumen los cálculos de borradores; no inventar keys nuevas aquí.
 */
const RULE_TYPE_LABELS: Record<string, string> = {
  vat: 'IVA',
  withholding: 'Retenciones',
  ica: 'ICA',
  income_tax: 'Renta',
  obligation_calendar: 'Calendario de obligaciones',
};

interface RuleTemplate {
  namePrefix: string;
  rules: Record<string, unknown>;
}

const RULE_TEMPLATES: Record<string, RuleTemplate> = {
  vat: {
    namePrefix: 'IVA Colombia',
    rules: {
      rates: [19, 5, 0],
      categories: ['gravado', 'exento', 'excluido'],
      disclaimer:
        'Reglas base para borrador. Validar con contador antes de presentar.',
    },
  },
  withholding: {
    namePrefix: 'Retenciones Colombia',
    rules: {
      source: 'withholding_concepts',
      supports_uvt: true,
      disclaimer: 'Usa conceptos configurados por entidad fiscal.',
    },
  },
  ica: {
    namePrefix: 'ICA Colombia',
    rules: {
      source: 'ica_municipal_rates',
      rate_unit: 'per_mil',
    },
  },
  income_tax: {
    namePrefix: 'Renta personas jurídicas',
    rules: {
      general_rate_percent: 35,
      legal_basis: 'Art. 240 ET (Ley 2277 de 2022)',
      disclaimer:
        'Estimación de precierre. No constituye declaración formal (formulario 110).',
    },
  },
  obligation_calendar: {
    namePrefix: 'Calendario fiscal base',
    rules: {
      monthly_due_day: 20,
      exogenous_due_month: 4,
      exogenous_due_day: 30,
      income_precierre_month: 3,
      income_precierre_day: 31,
    },
  },
};

/** Modo de editor del modal según el tipo de regla. */
type RuleEditorMode = 'income_tax' | 'vat' | 'calendar' | 'json';

/**
 * Tab "Reglas" de Operación fiscal.
 *
 * Lista las reglas fiscales (filas reales + defaults Vendix que devuelve el
 * backend cuando un tipo no tiene override) y, a nivel organización, permite
 * el ciclo completo: crear draft → editar → activar (archiva la activa
 * anterior del mismo tipo/año) → archivar. El scope store es solo lectura:
 * los endpoints de mutación existen únicamente en /organization/fiscal/rules.
 */
@Component({
  selector: 'app-fiscal-rules-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SelectorComponent,
    TextareaComponent,
    TooltipComponent,
  ],
  template: `
    <div class="space-y-4">
      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="Reglas fiscales">
          {{ msg }}
        </app-alert-banner>
      }

      @if (!canManage()) {
        <app-alert-banner variant="info" title="Reglas fiscales">
          Las reglas se administran a nivel de organización. Aquí puedes
          consultar las que aplican a tu tienda.
        </app-alert-banner>
      }

      <!-- Filtros + acción principal -->
      <app-card [responsive]="true" [padding]="false">
        <div
          class="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-end md:justify-between md:px-6 md:py-4"
        >
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-text-primary md:text-base">
              Reglas fiscales ({{ filteredRules().length }})
            </h2>
            <app-tooltip
              content="Tus reglas tienen prioridad; sin personalizar, aplican las base de Vendix."
              position="bottom"
              size="sm"
            >
              <app-icon name="info" [size]="15" class="text-text-secondary" />
            </app-tooltip>
          </div>
          <div class="flex flex-wrap items-end gap-2">
            <div class="w-28">
              <app-selector
                label="Año"
                size="sm"
                [options]="yearOptions"
                [ngModel]="filterYear()"
                (ngModelChange)="onYearChange($event)"
              />
            </div>
            <div class="w-44">
              <app-selector
                label="Tipo de regla"
                size="sm"
                [options]="typeFilterOptions"
                [ngModel]="filterType()"
                (ngModelChange)="onTypeChange($event)"
              />
            </div>
            <div class="w-36">
              <app-selector
                label="Estado"
                size="sm"
                [options]="statusFilterOptions"
                [ngModel]="filterStatus()"
                (ngModelChange)="onStatusChange($event)"
              />
            </div>
            @if (canManage()) {
              <app-button
                variant="primary"
                size="sm"
                [disabled]="working()"
                (clicked)="openCreate()"
              >
                <span class="inline-flex items-center gap-1.5">
                  <app-icon name="plus" [size]="14" />
                  Nueva regla
                </span>
              </app-button>
            }
          </div>
        </div>
      </app-card>

      <!-- Lista de reglas -->
      @if (loading()) {
        <app-card [responsive]="true">
          <div class="flex items-center justify-center gap-2 py-10">
            <app-icon
              name="loader-2"
              [size]="18"
              [spin]="true"
              class="text-primary-600"
            />
            <span class="text-sm text-text-secondary">Cargando reglas…</span>
          </div>
        </app-card>
      } @else {
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (rule of filteredRules(); track trackRule(rule)) {
            <app-card [responsive]="true">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-semibold text-text-primary">
                    {{ rule.name }}
                  </h3>
                  <p class="mt-1 text-xs text-text-secondary">
                    {{ typeLabel(rule.rule_type) }} · {{ rule.year }}
                  </p>
                </div>
                <app-badge [variant]="statusVariant(rule.status)" size="sm">
                  {{ statusLabel(rule.status) }}
                </app-badge>
              </div>

              <dl class="mt-4 space-y-2 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <dt class="flex items-center gap-1 text-text-secondary">
                    Origen
                  </dt>
                  <dd class="font-medium text-text-primary">
                    @if (isVendixRule(rule)) {
                      <span
                        class="rounded-md bg-primary-600/10 px-2 py-0.5 text-xs font-medium text-primary-700"
                      >
                        Vendix (default)
                      </span>
                    } @else {
                      Personalizada
                    }
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="flex items-center gap-1 text-text-secondary">
                    Vigencia
                    <app-tooltip
                      content="Período en el que la regla participa en los cálculos."
                      position="bottom"
                      size="sm"
                    >
                      <app-icon
                        name="info"
                        [size]="13"
                        class="text-text-secondary"
                      />
                    </app-tooltip>
                  </dt>
                  <dd class="font-medium text-text-primary">
                    {{ validityLabel(rule) }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="flex items-center gap-1 text-text-secondary">
                    Versión
                    <app-tooltip
                      content="Solo puede haber una versión activa por tipo y año."
                      position="bottom"
                      size="sm"
                    >
                      <app-icon
                        name="info"
                        [size]="13"
                        class="text-text-secondary"
                      />
                    </app-tooltip>
                  </dt>
                  <dd class="font-medium text-text-primary">
                    {{ rule.version }}
                  </dd>
                </div>
                <div class="flex items-start justify-between gap-3">
                  <dt class="flex items-center gap-1 text-text-secondary">
                    Resumen
                    @if (rule.rule_type === 'withholding') {
                      <app-tooltip
                        content="UVT: valor de referencia que la DIAN actualiza cada año."
                        position="bottom"
                        size="sm"
                      >
                        <app-icon
                          name="info"
                          [size]="13"
                          class="text-text-secondary"
                        />
                      </app-tooltip>
                    }
                  </dt>
                  <dd class="text-right font-medium text-text-primary">
                    {{ ruleSummary(rule) }}
                  </dd>
                </div>
              </dl>

              <div
                class="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3"
              >
                <app-button
                  variant="ghost"
                  size="sm"
                  (clicked)="openView(rule)"
                >
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon name="eye" [size]="14" />
                    Ver
                  </span>
                </app-button>
                @if (canManage()) {
                  @if (isVendixRule(rule)) {
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="working()"
                      (clicked)="openCustomize(rule)"
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <app-icon name="settings-2" [size]="14" />
                        Personalizar
                      </span>
                    </app-button>
                  } @else {
                    @if (rule.status === 'draft') {
                      <app-button
                        variant="outline"
                        size="sm"
                        [disabled]="working()"
                        (clicked)="openEdit(rule)"
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <app-icon name="edit-3" [size]="14" />
                          Editar
                        </span>
                      </app-button>
                      <app-button
                        variant="success"
                        size="sm"
                        [disabled]="working()"
                        (clicked)="pendingActivation.set(rule)"
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <app-icon name="check-circle" [size]="14" />
                          Activar
                        </span>
                      </app-button>
                    }
                    @if (rule.status !== 'archived') {
                      <app-button
                        variant="outline-warning"
                        size="sm"
                        [disabled]="working()"
                        (clicked)="pendingArchive.set(rule)"
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <app-icon name="archive" [size]="14" />
                          Archivar
                        </span>
                      </app-button>
                    }
                  }
                }
              </div>
            </app-card>
          } @empty {
            <app-card class="md:col-span-2 xl:col-span-3" [responsive]="true">
              <div class="py-10 text-center">
                <app-icon
                  name="settings-2"
                  [size]="28"
                  class="mx-auto text-text-secondary"
                />
                <p class="mt-3 text-sm font-medium text-text-primary">
                  Sin reglas para los filtros seleccionados
                </p>
                <p class="mt-1 text-sm text-text-secondary">
                  Ajusta el año, el tipo o el estado para ver más resultados.
                </p>
              </div>
            </app-card>
          }
        </div>
      }
    </div>

    <!-- Modal crear/editar -->
    <app-modal
      [(isOpen)]="formOpen"
      [title]="formTitle()"
      size="lg"
      [closeOnBackdrop]="false"
    >
      <form [formGroup]="form" class="space-y-4" (ngSubmit)="save()">
        @if (formError(); as msg) {
          <app-alert-banner variant="danger" title="Revisa el formulario">
            {{ msg }}
          </app-alert-banner>
        }

        <div class="grid gap-4 md:grid-cols-2">
          <app-selector
            label="Tipo de regla"
            [options]="typeOptions"
            [formControl]="ruleTypeControl"
            tooltipText="Cada tipo de regla alimenta un cálculo fiscal distinto."
          />
          <app-input
            label="Año fiscal"
            type="number"
            [formControl]="yearControl"
            [required]="true"
            min="2000"
            max="2100"
          />
        </div>

        <app-input
          label="Nombre"
          [formControl]="nameControl"
          [required]="true"
          placeholder="Ej.: Renta personas jurídicas 2026 (personalizada)"
        />

        <div class="grid gap-4 md:grid-cols-2">
          <app-input
            label="Versión"
            [formControl]="versionControl"
            placeholder="1"
            tooltipText="Distingue revisiones; no puede repetirse para el mismo tipo y año."
          />
          <app-input
            label="Vigente desde"
            type="date"
            [formControl]="effectiveFromControl"
            tooltipText="Si la dejas vacía, la regla aplica desde su creación."
          />
        </div>

        <!-- Editor amigable por tipo conocido -->
        @switch (editorMode()) {
          @case ('income_tax') {
            <app-input
              label="Tarifa general de renta (%)"
              type="number"
              [formControl]="incomeRateControl"
              [required]="true"
              min="0"
              max="100"
              step="0.1"
              helperText="Porcentaje aplicado en el precierre de renta (Art. 240 ET: 35% general)."
            />
          }
          @case ('vat') {
            <app-input
              label="Tarifas de IVA (%)"
              [formControl]="vatRatesControl"
              [required]="true"
              placeholder="19, 5, 0"
              helperText="Lista separada por comas. Tarifas vigentes en Colombia: 19 (general), 5 (reducida) y 0 (exenta)."
            />
          }
          @case ('calendar') {
            <div class="grid gap-4 md:grid-cols-2">
              <app-input
                label="Día de vencimiento mensual"
                type="number"
                [formControl]="monthlyDueDayControl"
                [required]="true"
                min="1"
                max="31"
                helperText="Día del mes en que vencen las obligaciones periódicas (IVA, retenciones, ICA)."
              />
              <app-input
                label="Mes límite de exógena"
                type="number"
                [formControl]="exogenousDueMonthControl"
                min="1"
                max="12"
              />
              <app-input
                label="Día límite de exógena"
                type="number"
                [formControl]="exogenousDueDayControl"
                min="1"
                max="31"
              />
              <app-input
                label="Mes del precierre de renta"
                type="number"
                [formControl]="incomePrecierreMonthControl"
                min="1"
                max="12"
              />
              <app-input
                label="Día del precierre de renta"
                type="number"
                [formControl]="incomePrecierreDayControl"
                min="1"
                max="31"
              />
            </div>
          }
          @default {
            <app-textarea
              label="Parámetros (JSON)"
              [formControl]="rulesJsonControl"
              [rows]="9"
              helperText="Este tipo no tiene editor visual: edita el JSON directamente. Debe ser un objeto JSON válido y no vacío."
            />
          }
        }
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button
          variant="outline"
          size="sm"
          [disabled]="working()"
          (clicked)="formOpen.set(false)"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          [disabled]="working()"
          (clicked)="save()"
        >
          {{ formMode() === 'edit' ? 'Guardar cambios' : 'Crear borrador' }}
        </app-button>
      </div>
    </app-modal>

    <!-- Modal de detalle (solo lectura) -->
    <app-modal
      [(isOpen)]="viewOpen"
      [title]="viewRule()?.name || 'Detalle de la regla'"
      size="lg"
    >
      @if (viewRule(); as rule) {
        <div class="space-y-4">
          <div class="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <p class="text-text-secondary">Tipo</p>
              <p class="font-medium text-text-primary">
                {{ typeLabel(rule.rule_type) }}
              </p>
            </div>
            <div>
              <p class="text-text-secondary">Estado</p>
              <app-badge [variant]="statusVariant(rule.status)" size="sm">
                {{ statusLabel(rule.status) }}
              </app-badge>
            </div>
            <div>
              <p class="text-text-secondary">Año · Versión</p>
              <p class="font-medium text-text-primary">
                {{ rule.year }} · {{ rule.version }}
              </p>
            </div>
            <div>
              <p class="text-text-secondary">Vigencia</p>
              <p class="font-medium text-text-primary">
                {{ validityLabel(rule) }}
              </p>
            </div>
            <div>
              <p class="text-text-secondary">Origen</p>
              <p class="font-medium text-text-primary">
                {{ isVendixRule(rule) ? 'Vendix (default)' : 'Personalizada' }}
              </p>
            </div>
            <div>
              <p class="text-text-secondary">Resumen</p>
              <p class="font-medium text-text-primary">
                {{ ruleSummary(rule) }}
              </p>
            </div>
          </div>
          <div>
            <p class="mb-1 text-sm text-text-secondary">Parámetros (JSON)</p>
            <pre
              class="max-h-72 overflow-auto rounded-md border border-border bg-[var(--color-surface)] p-3 text-xs text-text-primary"
              >{{ prettyRules(rule) }}</pre
            >
          </div>
        </div>
      }
      <div slot="footer" class="flex justify-end">
        <app-button variant="outline" size="sm" (clicked)="viewOpen.set(false)">
          Cerrar
        </app-button>
      </div>
    </app-modal>

    <!-- Confirmación de activación -->
    @if (pendingActivation(); as rule) {
      <app-confirmation-modal
        title="Activar regla fiscal"
        [message]="activationMessage(rule)"
        confirmText="Activar"
        cancelText="Cancelar"
        confirmVariant="primary"
        (confirm)="activate(rule)"
        (cancel)="pendingActivation.set(null)"
      />
    }

    <!-- Confirmación de archivado -->
    @if (pendingArchive(); as rule) {
      <app-confirmation-modal
        title="Archivar regla fiscal"
        [message]="archiveMessage(rule)"
        confirmText="Archivar"
        cancelText="Cancelar"
        confirmVariant="danger"
        (confirm)="archive(rule)"
        (cancel)="pendingArchive.set(null)"
      />
    }
  `,
})
export class FiscalRulesTabComponent {
  private readonly service = inject(FiscalOperationsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly scope = input.required<FiscalApiScope>();
  /** El padre lo incrementa cuando el usuario pide "refrescar" desde el header. */
  readonly reloadToken = input(0);

  /**
   * Las mutaciones existen en el API de organización y de plataforma
   * (ambos con su permiso dedicado). El scope store es solo lectura.
   */
  readonly canManage = computed(
    () => this.scope() === 'organization' || this.scope() === 'platform',
  );

  // --- Estado de la lista ---------------------------------------------------
  readonly rules = signal<FiscalRuleSetDetail[]>([]);
  readonly loading = signal(false);
  readonly working = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly filterYear = signal(new Date().getFullYear());
  readonly filterType = signal<string>('all');
  readonly filterStatus = signal<string>('all');

  readonly filteredRules = computed(() => {
    const type = this.filterType();
    const status = this.filterStatus();
    return this.rules().filter(
      (rule) =>
        (type === 'all' || rule.rule_type === type) &&
        (status === 'all' || rule.status === status),
    );
  });

  readonly yearOptions: SelectorOption[] = (() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1].map((y) => ({
      value: y,
      label: String(y),
    }));
  })();

  readonly typeOptions: SelectorOption[] = Object.entries(
    RULE_TYPE_LABELS,
  ).map(([value, label]) => ({ value, label }));

  readonly typeFilterOptions: SelectorOption[] = [
    { value: 'all', label: 'Todos los tipos' },
    ...this.typeOptions,
  ];

  readonly statusFilterOptions: SelectorOption[] = [
    { value: 'all', label: 'Todos los estados' },
    { value: 'draft', label: 'Borrador' },
    { value: 'active', label: 'Activa' },
    { value: 'archived', label: 'Archivada' },
  ];

  // --- Estado de modales ------------------------------------------------------
  readonly formOpen = signal(false);
  readonly formMode = signal<'create' | 'edit'>('create');
  readonly formError = signal<string | null>(null);
  readonly editingRule = signal<FiscalRuleSetDetail | null>(null);
  readonly viewOpen = signal(false);
  readonly viewRule = signal<FiscalRuleSetDetail | null>(null);
  readonly pendingActivation = signal<FiscalRuleSetDetail | null>(null);
  readonly pendingArchive = signal<FiscalRuleSetDetail | null>(null);

  /**
   * Objeto `rules` completo en edición. Los campos amigables solo
   * sobreescriben sus keys; el resto (disclaimer, legal_basis, etc.)
   * se preserva tal cual venga del template o de la regla original.
   */
  private readonly baseRules = signal<Record<string, unknown>>({});

  /** Tipo seleccionado en el modal (gobierna el editor amigable). */
  readonly modalRuleType = signal<string>('income_tax');

  readonly editorMode = computed<RuleEditorMode>(() => {
    const type = this.modalRuleType();
    if (type === 'income_tax') return 'income_tax';
    if (type === 'vat') return 'vat';
    if (type === 'obligation_calendar') return 'calendar';
    return 'json';
  });

  readonly formTitle = computed(() =>
    this.formMode() === 'edit'
      ? 'Editar regla fiscal (borrador)'
      : 'Nueva regla fiscal',
  );

  // --- Formulario -------------------------------------------------------------
  readonly form = new FormGroup({
    rule_type: new FormControl<string>('income_tax', { nonNullable: true }),
    year: new FormControl<number>(new Date().getFullYear(), {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(2000),
        Validators.max(2100),
      ],
    }),
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(150)],
    }),
    version: new FormControl<string>('1', {
      nonNullable: true,
      validators: [Validators.maxLength(40)],
    }),
    effective_from: new FormControl<string>('', { nonNullable: true }),
    income_rate: new FormControl<number | null>(null),
    vat_rates: new FormControl<string>('', { nonNullable: true }),
    monthly_due_day: new FormControl<number | null>(null),
    exogenous_due_month: new FormControl<number | null>(null),
    exogenous_due_day: new FormControl<number | null>(null),
    income_precierre_month: new FormControl<number | null>(null),
    income_precierre_day: new FormControl<number | null>(null),
    rules_json: new FormControl<string>('', { nonNullable: true }),
  });

  get ruleTypeControl(): FormControl<string> {
    return this.form.controls.rule_type;
  }
  get yearControl(): FormControl<number> {
    return this.form.controls.year;
  }
  get nameControl(): FormControl<string> {
    return this.form.controls.name;
  }
  get versionControl(): FormControl<string> {
    return this.form.controls.version;
  }
  get effectiveFromControl(): FormControl<string> {
    return this.form.controls.effective_from;
  }
  get incomeRateControl(): FormControl<number | null> {
    return this.form.controls.income_rate;
  }
  get vatRatesControl(): FormControl<string> {
    return this.form.controls.vat_rates;
  }
  get monthlyDueDayControl(): FormControl<number | null> {
    return this.form.controls.monthly_due_day;
  }
  get exogenousDueMonthControl(): FormControl<number | null> {
    return this.form.controls.exogenous_due_month;
  }
  get exogenousDueDayControl(): FormControl<number | null> {
    return this.form.controls.exogenous_due_day;
  }
  get incomePrecierreMonthControl(): FormControl<number | null> {
    return this.form.controls.income_precierre_month;
  }
  get incomePrecierreDayControl(): FormControl<number | null> {
    return this.form.controls.income_precierre_day;
  }
  get rulesJsonControl(): FormControl<string> {
    return this.form.controls.rules_json;
  }

  constructor() {
    // Carga inicial + recargas por cambio de scope, token del header o año.
    effect(() => {
      this.scope();
      this.reloadToken();
      this.filterYear();
      untracked(() => this.loadRules());
    });

    // Al cambiar el tipo en modo creación se precarga la plantilla
    // base de Colombia para ese tipo (mismas keys que usa el backend).
    this.form.controls.rule_type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((type) => {
        this.modalRuleType.set(type);
        if (this.formOpen() && this.formMode() === 'create') {
          this.applyTemplate(type);
        }
      });
  }

  // --- Carga ------------------------------------------------------------------

  loadRules(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .listRulesByYear(this.scope(), { year: this.filterYear() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rules.set(response.data || []);
          this.loading.set(false);
        },
        error: () => {
          this.errorMessage.set('No se pudieron cargar las reglas fiscales');
          this.loading.set(false);
        },
      });
  }

  onYearChange(value: string | number | null): void {
    const year = Number(value);
    if (Number.isFinite(year) && year > 0) this.filterYear.set(year);
  }

  onTypeChange(value: string | number | null): void {
    this.filterType.set(String(value ?? 'all'));
  }

  onStatusChange(value: string | number | null): void {
    this.filterStatus.set(String(value ?? 'all'));
  }

  // --- Apertura de modales ------------------------------------------------------

  openCreate(): void {
    this.formMode.set('create');
    this.editingRule.set(null);
    this.formError.set(null);
    this.resetForm('income_tax', this.filterYear());
    this.applyTemplate('income_tax');
    this.formOpen.set(true);
  }

  /** "Personalizar" una regla default de Vendix: creación pre-cargada con su JSON. */
  openCustomize(rule: FiscalRuleSetDetail): void {
    this.formMode.set('create');
    this.editingRule.set(null);
    this.formError.set(null);
    this.resetForm(rule.rule_type, rule.year);
    this.form.controls.name.setValue(`${rule.name} (personalizada)`, {
      emitEvent: false,
    });
    this.form.controls.name.markAsDirty();
    this.setBaseRules(rule.rule_type, rule.rules || {});
    this.formOpen.set(true);
  }

  openEdit(rule: FiscalRuleSetDetail): void {
    this.formMode.set('edit');
    this.editingRule.set(rule);
    this.formError.set(null);
    this.resetForm(rule.rule_type, rule.year, true);
    this.form.controls.name.setValue(rule.name, { emitEvent: false });
    this.form.controls.name.markAsDirty();
    this.form.controls.version.setValue(rule.version || '1', {
      emitEvent: false,
    });
    this.form.controls.effective_from.setValue(
      rule.effective_from ? rule.effective_from.slice(0, 10) : '',
      { emitEvent: false },
    );
    this.setBaseRules(rule.rule_type, rule.rules || {});
    this.formOpen.set(true);
  }

  openView(rule: FiscalRuleSetDetail): void {
    this.viewRule.set(rule);
    this.viewOpen.set(true);
  }

  private resetForm(ruleType: string, year: number, lockType = false): void {
    this.form.reset(
      {
        rule_type: ruleType,
        year,
        name: '',
        version: '1',
        effective_from: '',
        income_rate: null,
        vat_rates: '',
        monthly_due_day: null,
        exogenous_due_month: null,
        exogenous_due_day: null,
        income_precierre_month: null,
        income_precierre_day: null,
        rules_json: '',
      },
      { emitEvent: false },
    );
    // En edición el tipo no se cambia (el backend lo permite, pero cambiar
    // el tipo de un draft existente confunde el versionado por tipo/año).
    if (lockType) {
      this.form.controls.rule_type.disable({ emitEvent: false });
    } else {
      this.form.controls.rule_type.enable({ emitEvent: false });
    }
    this.modalRuleType.set(ruleType);
  }

  /** Precarga la plantilla default de Colombia para el tipo dado. */
  private applyTemplate(type: string): void {
    const template = RULE_TEMPLATES[type];
    const rules = template
      ? (JSON.parse(JSON.stringify(template.rules)) as Record<string, unknown>)
      : {};
    this.setBaseRules(type, rules);
    if (this.form.controls.name.pristine) {
      const year = Number(this.form.controls.year.value);
      const suggested = template
        ? `${template.namePrefix} ${year} (personalizada)`
        : '';
      this.form.controls.name.setValue(suggested, { emitEvent: false });
    }
  }

  /** Sincroniza baseRules + campos amigables + textarea JSON. */
  private setBaseRules(type: string, rules: Record<string, unknown>): void {
    this.baseRules.set(rules);
    const patch: Partial<{
      income_rate: number | null;
      vat_rates: string;
      monthly_due_day: number | null;
      exogenous_due_month: number | null;
      exogenous_due_day: number | null;
      income_precierre_month: number | null;
      income_precierre_day: number | null;
      rules_json: string;
    }> = { rules_json: JSON.stringify(rules, null, 2) };

    if (type === 'income_tax') {
      patch.income_rate = this.asNumber(rules['general_rate_percent']);
    } else if (type === 'vat') {
      const rates = Array.isArray(rules['rates']) ? rules['rates'] : [];
      patch.vat_rates = rates.join(', ');
    } else if (type === 'obligation_calendar') {
      patch.monthly_due_day = this.asNumber(rules['monthly_due_day']);
      patch.exogenous_due_month = this.asNumber(rules['exogenous_due_month']);
      patch.exogenous_due_day = this.asNumber(rules['exogenous_due_day']);
      patch.income_precierre_month = this.asNumber(
        rules['income_precierre_month'],
      );
      patch.income_precierre_day = this.asNumber(
        rules['income_precierre_day'],
      );
    }
    this.form.patchValue(patch, { emitEvent: false });
  }

  private asNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  // --- Guardado -----------------------------------------------------------------

  save(): void {
    this.form.markAllAsTouched();
    this.formError.set(null);

    const raw = this.form.getRawValue();
    if (!raw.name.trim()) {
      this.formError.set('El nombre es obligatorio.');
      return;
    }
    const year = Number(raw.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      this.formError.set('El año fiscal debe estar entre 2000 y 2100.');
      return;
    }

    const rules = this.buildRules();
    if (!rules) return;

    if (this.formMode() === 'edit') {
      const editing = this.editingRule();
      if (!editing?.id) return;
      const payload: UpdateFiscalRuleSetPayload = {
        name: raw.name.trim(),
        year,
        version: raw.version.trim() || '1',
        rules,
        ...(raw.effective_from
          ? { effective_from: raw.effective_from }
          : {}),
      };
      this.working.set(true);
      this.service
        .updateRule(editing.id, payload, this.scope())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.working.set(false);
            this.formOpen.set(false);
            this.toast.success('Borrador actualizado');
            this.loadRules();
          },
          error: (err) => {
            this.working.set(false);
            this.formError.set(
              this.apiError(err, 'No se pudo actualizar el borrador'),
            );
          },
        });
      return;
    }

    const payload: CreateFiscalRuleSetPayload = {
      name: raw.name.trim(),
      rule_type: raw.rule_type,
      year,
      version: raw.version.trim() || '1',
      rules,
      ...(raw.effective_from ? { effective_from: raw.effective_from } : {}),
    };
    this.working.set(true);
    this.service
      .createRule(payload, this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.working.set(false);
          this.formOpen.set(false);
          this.toast.success(
            'Borrador creado. Actívalo para que aplique en los cálculos.',
          );
          this.loadRules();
        },
        error: (err) => {
          this.working.set(false);
          this.formError.set(
            this.apiError(err, 'No se pudo crear la regla'),
          );
        },
      });
  }

  /**
   * Construye el objeto `rules` final: campos amigables sobre la base
   * preservada, o JSON validado para tipos sin editor visual.
   */
  private buildRules(): Record<string, unknown> | null {
    const mode = this.editorMode();
    const raw = this.form.getRawValue();
    const base = { ...this.baseRules() };

    if (mode === 'income_tax') {
      const rate = Number(raw.income_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        this.formError.set('La tarifa de renta debe estar entre 0 y 100.');
        return null;
      }
      base['general_rate_percent'] = rate;
      return base;
    }

    if (mode === 'vat') {
      const rates = raw.vat_rates
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .map((item) => Number(item));
      if (
        rates.length === 0 ||
        rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)
      ) {
        this.formError.set(
          'Ingresa tarifas de IVA válidas separadas por comas (entre 0 y 100).',
        );
        return null;
      }
      base['rates'] = rates;
      return base;
    }

    if (mode === 'calendar') {
      const dueDay = Number(raw.monthly_due_day);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        this.formError.set(
          'El día de vencimiento mensual debe estar entre 1 y 31.',
        );
        return null;
      }
      base['monthly_due_day'] = dueDay;
      const optionals: Array<{
        key: string;
        value: number | null;
        max: number;
        label: string;
      }> = [
        { key: 'exogenous_due_month', value: raw.exogenous_due_month, max: 12, label: 'mes límite de exógena' },
        { key: 'exogenous_due_day', value: raw.exogenous_due_day, max: 31, label: 'día límite de exógena' },
        { key: 'income_precierre_month', value: raw.income_precierre_month, max: 12, label: 'mes del precierre de renta' },
        { key: 'income_precierre_day', value: raw.income_precierre_day, max: 31, label: 'día del precierre de renta' },
      ];
      for (const field of optionals) {
        if (field.value === null || field.value === undefined) continue;
        const num = Number(field.value);
        if (!Number.isInteger(num) || num < 1 || num > field.max) {
          this.formError.set(
            `El ${field.label} debe estar entre 1 y ${field.max}.`,
          );
          return null;
        }
        base[field.key] = num;
      }
      return base;
    }

    // Fallback JSON para tipos sin editor visual (withholding, ica, otros).
    try {
      const parsed = JSON.parse(raw.rules_json || '');
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.keys(parsed as Record<string, unknown>).length === 0
      ) {
        this.formError.set(
          'Los parámetros deben ser un objeto JSON no vacío.',
        );
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      this.formError.set('El JSON de parámetros no es válido.');
      return null;
    }
  }

  // --- Activar / archivar ----------------------------------------------------------

  activate(rule: FiscalRuleSetDetail): void {
    this.pendingActivation.set(null);
    if (!rule.id) return;
    this.working.set(true);
    this.service
      .activateRule(rule.id, this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.working.set(false);
          this.toast.success('Regla activada');
          this.loadRules();
        },
        error: (err) => {
          this.working.set(false);
          this.toast.error(this.apiError(err, 'No se pudo activar la regla'));
        },
      });
  }

  archive(rule: FiscalRuleSetDetail): void {
    this.pendingArchive.set(null);
    if (!rule.id) return;
    this.working.set(true);
    this.service
      .archiveRule(rule.id, this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.working.set(false);
          this.toast.success('Regla archivada');
          this.loadRules();
        },
        error: (err) => {
          this.working.set(false);
          this.toast.error(
            this.apiError(err, 'No se pudo archivar la regla'),
          );
        },
      });
  }

  activationMessage(rule: FiscalRuleSetDetail): string {
    return (
      `Al activar "${rule.name}" se archivará automáticamente la versión ` +
      `activa anterior de ${this.typeLabel(rule.rule_type)} para ${rule.year}. ` +
      'A partir de ese momento esta regla alimentará los cálculos fiscales. ¿Deseas continuar?'
    );
  }

  archiveMessage(rule: FiscalRuleSetDetail): string {
    return (
      `"${rule.name}" dejará de aplicar en los cálculos fiscales. ` +
      'Si no existe otra regla activa del mismo tipo y año, volverán a usarse las reglas base de Vendix.'
    );
  }

  // --- Presentación -----------------------------------------------------------------

  trackRule(rule: FiscalRuleSetDetail): string {
    return rule.id
      ? `id-${rule.id}`
      : `default-${rule.rule_type}-${rule.year}-${rule.version}`;
  }

  /** Defaults Vendix del list() no traen id; filas globales tampoco tienen organization_id. */
  isVendixRule(rule: FiscalRuleSetDetail): boolean {
    return !rule.id || !rule.organization_id;
  }

  typeLabel(type: string): string {
    return RULE_TYPE_LABELS[type] || type;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      active: 'Activa',
      archived: 'Archivada',
    };
    return labels[status] || status;
  }

  statusVariant(status: string): BadgeVariant {
    if (status === 'active') return 'success';
    return 'neutral';
  }

  validityLabel(rule: FiscalRuleSetDetail): string {
    if (!rule.effective_from) return `Año ${rule.year}`;
    const from = formatDateOnlyUTC(rule.effective_from);
    return rule.effective_to
      ? `${from} → ${formatDateOnlyUTC(rule.effective_to)}`
      : `Desde ${from}`;
  }

  /** Resumen legible del JSON `rules` según las keys reales de cada tipo. */
  ruleSummary(rule: FiscalRuleSetDetail): string {
    const rules = rule.rules || {};
    switch (rule.rule_type) {
      case 'vat': {
        const rates = Array.isArray(rules['rates']) ? rules['rates'] : [];
        return rates.length
          ? `Tarifas: ${rates.map((rate) => `${rate}%`).join(', ')}`
          : 'Sin tarifas definidas';
      }
      case 'income_tax': {
        const rate = rules['general_rate_percent'];
        return rate !== undefined && rate !== null
          ? `Tarifa: ${rate}%`
          : 'Sin tarifa definida';
      }
      case 'withholding': {
        const uvt = rules['supports_uvt'] ? ' · usa UVT' : '';
        return `Conceptos de retención configurados${uvt}`;
      }
      case 'ica': {
        const unit = rules['rate_unit'];
        return unit === 'per_mil'
          ? 'Tarifas municipales (por mil)'
          : 'Tarifas municipales';
      }
      case 'obligation_calendar': {
        const day = rules['monthly_due_day'];
        return day
          ? `Vencimiento mensual: día ${day}`
          : 'Calendario de vencimientos';
      }
      default: {
        const count = Object.keys(rules).length;
        return `${count} ${count === 1 ? 'parámetro' : 'parámetros'}`;
      }
    }
  }

  prettyRules(rule: FiscalRuleSetDetail): string {
    return JSON.stringify(rule.rules || {}, null, 2);
  }

  private apiError(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: string | string[] } })
      ?.error?.message;
    if (Array.isArray(message)) return message.join(' · ');
    return typeof message === 'string' && message ? message : fallback;
  }
}
