import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  AIFeatureFlags,
  PlanPricing,
  PlanType,
  PlanState,
} from '../../interfaces/subscription-admin.interface';
import {
  InputComponent,
  TextareaComponent,
  ToggleComponent,
  SelectorComponent,
  ScrollableTabsComponent,
} from '../../../../../../shared/components';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { AiFeatureMatrixComponent } from '../../components/ai-feature-matrix.component';
import { PricingCycleEditorComponent } from '../../components/pricing-cycle-editor.component';
import { GraceThresholdEditorComponent } from '../../components/grace-threshold-editor.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

interface PlanFormControls {
  // Identity
  code: FormControl<string>;
  name: FormControl<string>;
  description: FormControl<string>;
  // Type / state
  plan_type: FormControl<PlanType>;
  state: FormControl<PlanState>;
  // Money
  setup_fee: FormControl<number | null>;
  // Trial + dunning
  trial_days: FormControl<number>;
  grace_period_soft_days: FormControl<number>;
  grace_period_hard_days: FormControl<number>;
  suspension_day: FormControl<number>;
  cancellation_day: FormControl<number>;
  // Partner
  resellable: FormControl<boolean>;
  max_partner_margin_pct: FormControl<number | null>;
  // Promotional
  is_promotional: FormControl<boolean>;
  promo_priority: FormControl<number>;
  // Display
  is_popular: FormControl<boolean>;
  sort_order: FormControl<number>;
  is_default: FormControl<boolean>;
}

@Component({
  selector: 'app-plan-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
    SelectorComponent,
    ScrollableTabsComponent,
    StickyHeaderComponent,
    AiFeatureMatrixComponent,
    PricingCycleEditorComponent,
    GraceThresholdEditorComponent,
  ],
  template: `
    <div class="flex flex-col">
      <app-sticky-header
        [title]="isEdit() ? 'Editar plan' : 'Nuevo plan'"
        [subtitle]="
          isEdit()
            ? 'Modifica los parámetros del plan'
            : 'Crea un nuevo plan de suscripción'
        "
        [icon]="isEdit() ? 'credit-card' : 'plus-circle'"
        variant="glass"
        [showBackButton]="true"
        backRoute="/super-admin/subscriptions/plans"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      ></app-sticky-header>

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="px-2 md:px-6 pb-6 space-y-6">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab()"
          (tabChange)="activeTab.set($event)"
        ></app-scrollable-tabs>

        @if (activeTab() === 'overview') {
          <!-- Información básica -->
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Información básica
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-input
                label="Código (slug)"
                formControlName="code"
                [control]="form.get('code')"
                [required]="true"
                [readonly]="isEdit()"
                helperText="Identificador único del plan (no editable tras la creación)"
              ></app-input>

              <app-input
                label="Nombre"
                formControlName="name"
                [control]="form.get('name')"
                [required]="true"
              ></app-input>
            </div>

            <app-textarea
              label="Descripción"
              formControlName="description"
              [control]="form.get('description')"
              [rows]="3"
            ></app-textarea>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <app-selector
                label="Tipo de plan"
                formControlName="plan_type"
                [options]="planTypeOptions"
                [required]="true"
              ></app-selector>

              <app-selector
                label="Estado"
                formControlName="state"
                [options]="planStateOptions"
                [required]="true"
              ></app-selector>
            </div>
          </div>

          <!-- Partner -->
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Partner
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div class="flex items-center gap-2">
                <app-toggle formControlName="resellable"></app-toggle>
                <span class="text-sm text-text-primary">Revendible por partners</span>
              </div>

              <app-input
                label="Margen máximo del partner (%)"
                type="number"
                [min]="0"
                [max]="100"
                formControlName="max_partner_margin_pct"
                [control]="form.get('max_partner_margin_pct')"
                helperText="Dejar vacío si no aplica"
              ></app-input>
            </div>
          </div>

          <!-- Promoción -->
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Promoción
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div class="flex items-center gap-2">
                <app-toggle formControlName="is_promotional"></app-toggle>
                <span class="text-sm text-text-primary">Plan promocional</span>
              </div>

              <app-input
                label="Prioridad promocional"
                type="number"
                [min]="0"
                formControlName="promo_priority"
                [control]="form.get('promo_priority')"
              ></app-input>
            </div>
          </div>

          <!-- Display -->
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
              Visualización
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div class="flex items-center gap-2">
                <app-toggle formControlName="is_popular"></app-toggle>
                <span class="text-sm text-text-primary">Marcar como popular</span>
              </div>

              <div class="flex items-center gap-2">
                <app-toggle formControlName="is_default"></app-toggle>
                <span class="text-sm text-text-primary">Plan por defecto</span>
              </div>

              <app-input
                label="Orden"
                type="number"
                [min]="0"
                formControlName="sort_order"
                [control]="form.get('sort_order')"
              ></app-input>
            </div>
          </div>
        }

        @if (activeTab() === 'ai-matrix') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6">
            <app-ai-feature-matrix
              [initialValue]="aiFeatures()"
              (valueChange)="onAIFeaturesChange($event)"
            ></app-ai-feature-matrix>
          </div>
        }

        @if (activeTab() === 'pricing') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-4">
            <app-pricing-cycle-editor
              [initialValue]="pricing()"
              (valueChange)="onPricingChange($event)"
            ></app-pricing-cycle-editor>

            <div class="pt-4 border-t border-border">
              <app-input
                label="Cuota de configuración (setup fee)"
                type="number"
                [min]="0"
                formControlName="setup_fee"
                [control]="form.get('setup_fee')"
                helperText="Cobro único al activar el plan. Dejar vacío si no aplica."
              ></app-input>
            </div>
          </div>
        }

        @if (activeTab() === 'grace') {
          <div class="bg-surface rounded-card border border-border p-4 md:p-6 space-y-6">
            <!-- Trial -->
            <div class="space-y-4">
              <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Trial
              </h2>
              <app-input
                label="Días de trial"
                type="number"
                [min]="0"
                formControlName="trial_days"
                [control]="form.get('trial_days')"
              ></app-input>
            </div>

            <!-- Período de gracia -->
            <div class="space-y-4 pt-4 border-t border-border">
              <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Período de gracia
              </h2>
              <app-grace-threshold-editor
                [initialValue]="graceDays()"
                (valueChange)="onGraceChange($event)"
              ></app-grace-threshold-editor>
              <app-input
                label="Gracia dura (días)"
                type="number"
                [min]="0"
                formControlName="grace_period_hard_days"
                [control]="form.get('grace_period_hard_days')"
              ></app-input>
            </div>

            <!-- Cobranza -->
            <div class="space-y-4 pt-4 border-t border-border">
              <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
                Cobranza
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-input
                  label="Día de suspensión"
                  type="number"
                  [min]="0"
                  formControlName="suspension_day"
                  [control]="form.get('suspension_day')"
                ></app-input>
                <app-input
                  label="Día de cancelación"
                  type="number"
                  [min]="0"
                  formControlName="cancellation_day"
                  [control]="form.get('cancellation_day')"
                ></app-input>
              </div>
            </div>
          </div>
        }
      </form>
    </div>
  `,
})
export class PlanFormComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  private toast = inject(ToastService);

  readonly planId = signal<string | null>(null);
  readonly isEdit = signal(false);
  readonly submitting = signal(false);
  readonly activeTab = signal('overview');
  readonly aiFeatures = signal<AIFeatureFlags | undefined>(undefined);
  readonly pricing = signal<PlanPricing[] | undefined>(undefined);
  readonly graceDays = signal<number | undefined>(undefined);

  readonly tabs = [
    { id: 'overview', label: 'Resumen', icon: 'file-text' },
    { id: 'ai-matrix', label: 'Matriz IA', icon: 'bot' },
    { id: 'pricing', label: 'Precios', icon: 'credit-card' },
    { id: 'grace', label: 'Trial & Gracia', icon: 'clock' },
  ];

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'cancel',
      label: 'Cancelar',
      variant: 'outline',
      icon: 'x',
      disabled: this.submitting(),
    },
    {
      id: 'save',
      label: this.isEdit() ? 'Actualizar plan' : 'Crear plan',
      variant: 'primary',
      icon: 'save',
      loading: this.submitting(),
      disabled: this.submitting(),
    },
  ]);

  readonly planTypeOptions = [
    { value: 'base', label: 'Base' },
    { value: 'partner_custom', label: 'Custom de partner' },
    { value: 'promotional', label: 'Promocional' },
  ];

  readonly planStateOptions = [
    { value: 'draft', label: 'Borrador' },
    { value: 'active', label: 'Activo' },
    { value: 'archived', label: 'Archivado' },
  ];

  form: FormGroup<PlanFormControls> = this.fb.group<PlanFormControls>({
    // Identity
    code: this.fb.nonNullable.control('', [Validators.required]),
    name: this.fb.nonNullable.control('', [Validators.required]),
    description: this.fb.nonNullable.control(''),
    // Type / state
    plan_type: this.fb.nonNullable.control<PlanType>('base', [Validators.required]),
    state: this.fb.nonNullable.control<PlanState>('draft', [Validators.required]),
    // Money
    setup_fee: this.fb.control<number | null>(null, [Validators.min(0)]),
    // Trial + dunning
    trial_days: this.fb.nonNullable.control(0, [Validators.min(0)]),
    grace_period_soft_days: this.fb.nonNullable.control(3, [Validators.min(0)]),
    grace_period_hard_days: this.fb.nonNullable.control(7, [Validators.min(0)]),
    suspension_day: this.fb.nonNullable.control(14, [Validators.min(0)]),
    cancellation_day: this.fb.nonNullable.control(30, [Validators.min(0)]),
    // Partner
    resellable: this.fb.nonNullable.control(true),
    max_partner_margin_pct: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(100)]),
    // Promotional
    is_promotional: this.fb.nonNullable.control(false),
    promo_priority: this.fb.nonNullable.control(0, [Validators.min(0)]),
    // Display
    is_popular: this.fb.nonNullable.control(false),
    sort_order: this.fb.nonNullable.control(0, [Validators.min(0)]),
    is_default: this.fb.nonNullable.control(false),
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.planId.set(id);
      this.isEdit.set(true);
      // code es identificador inmutable post-creación
      this.form.controls.code.disable({ emitEvent: false });
      this.loadPlan(id);
    }
  }

  loadPlan(id: string): void {
    this.service.getPlanById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (!res.success) return;
        const plan = res.data;
        this.form.patchValue({
          code: plan.code,
          name: plan.name,
          description: plan.description ?? '',
          plan_type: plan.plan_type,
          state: plan.state,
          setup_fee: plan.setup_fee,
          trial_days: plan.trial_days ?? 0,
          grace_period_soft_days: plan.grace_period_soft_days ?? 0,
          grace_period_hard_days: plan.grace_period_hard_days ?? 0,
          suspension_day: plan.suspension_day ?? 0,
          cancellation_day: plan.cancellation_day ?? 0,
          resellable: plan.resellable,
          max_partner_margin_pct: plan.max_partner_margin_pct,
          is_promotional: plan.is_promotional,
          promo_priority: plan.promo_priority ?? 0,
          is_popular: plan.is_popular,
          sort_order: plan.sort_order ?? 0,
          is_default: plan.is_default,
        });
        this.aiFeatures.set(plan.ai_feature_flags);
        this.pricing.set(plan.pricing);
        this.graceDays.set(plan.grace_period_soft_days ?? plan.grace_threshold_days ?? 0);
      },
    });
  }

  onAIFeaturesChange(flags: AIFeatureFlags): void {
    this.aiFeatures.set(flags);
  }

  onPricingChange(pricing: PlanPricing[]): void {
    this.pricing.set(pricing);
  }

  onGraceChange(days: number): void {
    this.graceDays.set(days);
    // Mantener consistencia con los controles del form
    this.form.patchValue({ grace_period_soft_days: days });
  }

  goBack(): void {
    this.router.navigate(['/super-admin/subscriptions/plans']);
  }

  onHeaderAction(id: string): void {
    if (id === 'cancel') this.goBack();
    if (id === 'save') this.onSubmit();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // Defensa: garantizar al menos un item de pricing
    let pricing = this.pricing() ?? [];
    if (pricing.length === 0) {
      pricing = [
        {
          id: 'new-monthly',
          billing_cycle: 'monthly',
          price: 0,
          currency_code: 'COP',
          is_default: true,
        },
      ];
    }

    // Pricing default rige el base_price + billing_cycle + currency canónicos
    const pricingFirst = pricing.find((p) => p.is_default) ?? pricing[0];

    // Warning si ai_feature_flags está vacío
    const flags = this.aiFeatures() as Record<string, any> | undefined;
    if (!flags || Object.keys(flags).length === 0) {
      this.toast.warning('No se han configurado funciones de IA para este plan.', 'Funciones IA vacías');
    }

    this.submitting.set(true);

    // getRawValue() incluye campos disabled (code en edit)
    const raw = this.form.getRawValue();

    const payload: Record<string, any> = {
      ...raw,
      base_price: Number(pricingFirst.price ?? 0),
      currency: pricingFirst.currency_code ?? 'COP',
      billing_cycle: pricingFirst.billing_cycle ?? 'monthly',
      ai_feature_flags: this.aiFeatures(),
    };

    // En modo edit no reenviamos code (es inmutable e identificador del recurso)
    if (this.isEdit()) {
      delete payload['code'];
    }

    const request = this.isEdit()
      ? this.service.updatePlan(this.planId()!, payload)
      : this.service.createPlan(payload as any);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) {
          this.router.navigate(['/super-admin/subscriptions/plans']);
        }
        this.submitting.set(false);
      },
      error: () => this.submitting.set(false),
    });
  }
}
