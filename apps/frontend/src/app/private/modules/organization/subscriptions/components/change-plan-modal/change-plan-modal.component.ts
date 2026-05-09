import { Component, input, output, inject, signal, model, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
  CardComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { OrgSubscriptionsService } from '../../services/org-subscriptions.service';

interface PlanOption {
  id: number;
  name: string;
  code: string;
  base_price: number;
  billing_cycle: string;
  is_current?: boolean;
}

interface ProrationPreview {
  kind: 'upgrade' | 'downgrade' | 'same-tier';
  days_remaining: number;
  cycle_days: number;
  old_effective_price: string;
  new_effective_price: string;
  proration_amount: string;
  applies_immediately: boolean;
  invoice_to_issue: {
    total: string;
    period_start: string;
    period_end: string;
    line_items: Array<{
      description: string;
      quantity: number;
      unit_price: string;
      total: string;
    }>;
    split_breakdown: {
      vendix_share: string;
      partner_share: string;
      margin_pct_used: string;
      partner_org_id: number | null;
    };
  } | null;
  credit_to_apply_next_cycle: string;
}

@Component({
  selector: 'app-change-plan-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    CardComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Cambiar Plan"
      size="lg"
      (cancel)="close()"
    >
      <div class="p-4 space-y-6">
        @if (loadingPlans()) {
          <div class="p-8 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        }

        @if (!loadingPlans() && plans().length > 0) {
          <div class="space-y-3">
            <label class="block text-sm font-medium text-text-primary">Selecciona un plan</label>
            @for (plan of plans(); track plan.id) {
              <div
                class="p-4 border rounded-xl cursor-pointer transition-all"
                [class.border-primary]="selectedPlanId() === plan.id"
                [class.bg-primary/5]="selectedPlanId() === plan.id"
                [class.border-border]="selectedPlanId() !== plan.id"
                [class.hover:border-primary/50]="selectedPlanId() !== plan.id"
                (click)="selectPlan(plan)"
              >
                <div class="flex justify-between items-start">
                  <div>
                    <p class="font-semibold text-text-primary">{{ plan.name }}</p>
                    <p class="text-sm text-text-secondary">{{ plan.code }} • {{ plan.billing_cycle }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-lg font-bold text-primary">{{ formatCurrency(plan.base_price) }}</p>
                    <p class="text-xs text-text-muted">/mes</p>
                  </div>
                </div>
                @if (plan.is_current) {
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary mt-2">
                    Plan Actual
                  </span>
                }
              </div>
            }
          </div>
        }

        @if (preview()) {
          <div class="border-t pt-4 space-y-3">
            <h4 class="font-semibold text-text-primary">Vista Previa del Cambio</h4>

            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-xs text-text-muted uppercase">Tipo</p>
                <p class="font-medium capitalize">{{ preview()!.kind }}</p>
              </div>
              <div class="p-3 bg-gray-50 rounded-lg">
                <p class="text-xs text-text-muted uppercase">Días restantes</p>
                <p class="font-medium">{{ preview()!.days_remaining }} de {{ preview()!.cycle_days }}</p>
              </div>
            </div>

            @if (preview()!.proration_amount !== '0.00') {
              <div class="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-sm text-text-secondary">Prorrateo</span>
                  <span [class]="preview()!.kind === 'upgrade' ? 'text-green-600' : 'text-red-600'">
                    {{ preview()!.kind === 'upgrade' ? '+' : '' }}{{ formatCurrency(preview()!.proration_amount) }}
                  </span>
                </div>
                @if (preview()!.kind === 'downgrade') {
                  <p class="text-xs text-text-muted">
                    Crédito de {{ formatCurrency(preview()!.credit_to_apply_next_cycle) }} aplicado al próximo ciclo
                  </p>
                }
              </div>
            }

            @if (preview()!.invoice_to_issue) {
              <div class="p-4 border border-border rounded-xl space-y-2">
                <p class="text-sm font-semibold text-text-primary">Factura a Emitir</p>
                <div class="flex justify-between">
                  <span class="text-sm text-text-secondary">Total</span>
                  <span class="font-bold text-primary">{{ formatCurrency(preview()!.invoice_to_issue!.total) }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-sm text-text-secondary">Período</span>
                  <span class="text-sm">{{ formatDate(preview()!.invoice_to_issue!.period_start) }} - {{ formatDate(preview()!.invoice_to_issue!.period_end) }}</span>
                </div>
                @if (preview()!.invoice_to_issue!.split_breakdown.partner_org_id) {
                  <div class="mt-3 pt-3 border-t space-y-1">
                    <p class="text-xs font-semibold text-text-muted uppercase">Detalle Split</p>
                    <div class="flex justify-between">
                      <span class="text-sm text-text-secondary">Vendix (Base)</span>
                      <span class="text-sm">{{ formatCurrency(preview()!.invoice_to_issue!.split_breakdown.vendix_share) }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-sm text-text-secondary">Partner ({{ preview()!.invoice_to_issue!.split_breakdown.margin_pct_used }}%)</span>
                      <span class="text-sm">{{ formatCurrency(preview()!.invoice_to_issue!.split_breakdown.partner_share) }}</span>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }

        @if (error()) {
          <div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {{ error() }}
          </div>
        }
      </div>

      <div slot="footer" class="flex gap-3 justify-end w-full">
        <app-button variant="ghost" (clicked)="close()">Cancelar</app-button>
        @if (selectedPlanId() && !preview()) {
          <app-button variant="primary" [loading]="loadingPreview()" (clicked)="loadPreview()">
            Ver Preview
          </app-button>
        }
        @if (preview()) {
          <app-button variant="primary" [loading]="submitting()" (clicked)="confirmChange()">
            Confirmar Cambio
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class ChangePlanModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  private orgSubsService = inject(OrgSubscriptionsService);

  readonly isOpen = model<boolean>(false);
  readonly currentPlanId = input<number | null>(null);
  /**
   * Store the plan change targets. ORG_ADMIN tokens carry no implicit
   * `store_id`, so the org-level checkout endpoints require it explicitly.
   */
  readonly storeId = input.required<number>();
  readonly planChanged = output<void>();

  readonly plans = signal<PlanOption[]>([]);
  readonly loadingPlans = signal(false);
  readonly loadingPreview = signal(false);
  readonly submitting = signal(false);
  readonly selectedPlanId = signal<number | null>(null);
  readonly preview = signal<ProrationPreview | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.currencyService.loadCurrency();
  }

  open(): void {
    this.preview.set(null);
    this.selectedPlanId.set(null);
    this.error.set(null);
    this.isOpen.set(true);
    this.loadPlans();
  }

  close(): void {
    this.isOpen.set(false);
    this.preview.set(null);
    this.selectedPlanId.set(null);
    this.error.set(null);
  }

  private loadPlans(): void {
    this.loadingPlans.set(true);
    this.orgSubsService.getPlans(this.storeId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            const plans = res.data.map((p: any) => ({
              ...p,
              base_price: Number(p.base_price) || 0,
              is_current: p.id === this.currentPlanId(),
            }));
            this.plans.set(plans);
          }
          this.loadingPlans.set(false);
        },
        error: () => {
          this.loadingPlans.set(false);
          this.error.set('Error al cargar planes');
        },
      });
  }

  selectPlan(plan: PlanOption): void {
    if (plan.is_current) return;
    this.selectedPlanId.set(plan.id);
    this.preview.set(null);
    this.error.set(null);
  }

  loadPreview(): void {
    const planId = this.selectedPlanId();
    if (!planId) return;

    this.loadingPreview.set(true);
    this.error.set(null);

    this.orgSubsService.previewPlanChange(this.storeId(), planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loadingPreview.set(false);
          if (res.success && res.data?.proration) {
            this.preview.set(res.data.proration);
          } else {
            this.error.set('No se pudo generar la preview');
          }
        },
        error: (err) => {
          this.loadingPreview.set(false);
          this.error.set(err?.error?.message || 'Error al cargar preview');
        },
      });
  }

  confirmChange(): void {
    const planId = this.selectedPlanId();
    if (!planId) return;

    this.submitting.set(true);
    this.error.set(null);

    this.orgSubsService.commitPlanChange(this.storeId(), planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.toastService.success('Plan cambiado exitosamente');
          this.planChanged.emit();
          this.close();
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Error al cambiar plan');
        },
      });
  }

  formatCurrency(value: number | string): string {
    return this.currencyService.format(Number(value) || 0);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  }
}
