import { Component, computed, inject, input, model, output, signal } from '@angular/core';
import {
  ActivatePlanCurrentSubscription,
  ActivatePlanCycleOption,
  ActivatePlanGroupOption,
} from '../../interfaces/subscription-admin.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { PlanDetailPanelComponent, planCycleLabel } from './plan-detail-panel.component';

interface CatalogSection {
  key: string;
  title: string;
  notice: string | null;
  groups: ActivatePlanGroupOption[];
}

const SECTION_DEFS: { key: string; title: string; notice: string | null }[] = [
  { key: 'base', title: 'Planes', notice: null },
  {
    key: 'promotional',
    title: 'Promocionales',
    notice:
      'Se asigna como plan base. Para sumar beneficios temporales usa la asignación de plan promocional.',
  },
  {
    key: 'partner_custom',
    title: 'Partner',
    notice: 'El precio final depende del acuerdo del partner con la tienda.',
  },
  { key: 'other', title: 'Otros', notice: null },
];

const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  biannual: 6,
  annual: 12,
};

function normalizeText(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

@Component({
  selector: 'app-plan-catalog-step',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    ToggleComponent,
    PlanDetailPanelComponent,
  ],
  template: `
    @if (loading()) {
      <div class="space-y-3" aria-busy="true" aria-label="Cargando planes">
        @for (i of skeletonRows; track i) {
          <div class="h-20 rounded-xl bg-surface border border-border animate-pulse"></div>
        }
      </div>
    } @else if (error()) {
      <app-alert-banner variant="danger" icon="alert-circle">
        {{ error() }}
        <div bannerActions class="mt-2">
          <app-button variant="outline" size="sm" (clicked)="retry.emit()">Reintentar</app-button>
        </div>
      </app-alert-banner>
    } @else {
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div class="space-y-4 min-w-0">
          <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div class="relative flex-1">
              <app-icon
                name="search"
                [size]="16"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
              ></app-icon>
              <input
                type="search"
                class="w-full min-h-[44px] rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="Buscar plan por nombre o código"
                aria-label="Buscar plan"
                [value]="search()"
                (input)="onSearch($event)"
              />
            </div>
            <div class="flex items-center gap-2 text-sm text-text-secondary min-h-[44px]">
              <app-toggle
                [checked]="showDrafts()"
                (toggled)="showDrafts.set($event)"
                ariaLabel="Mostrar borradores"
              ></app-toggle>
              Mostrar borradores
            </div>
          </div>

          @if (sections().length === 0) {
            <app-empty-state
              icon="inbox"
              [title]="emptyTitle()"
              description=""
              [showActionButton]="false"
            ></app-empty-state>
          }

          @for (section of sections(); track section.key) {
            <section class="space-y-2">
              <h3 class="text-xs font-medium uppercase tracking-wide text-text-secondary">
                {{ section.title }}
              </h3>
              @if (section.notice) {
                <p class="text-xs text-text-secondary">{{ section.notice }}</p>
              }
              <div class="space-y-2">
                @for (g of section.groups; track g.group_code) {
                  @let selectable = hasActive(g);
                  <button
                    type="button"
                    class="w-full text-left min-h-[44px] rounded-xl border p-3 space-y-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                    [class]="
                      selectedGroup()?.group_code === g.group_code
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-surface hover:border-primary/40'
                    "
                    [class.opacity-60]="!selectable"
                    [class.cursor-not-allowed]="!selectable"
                    [disabled]="!selectable"
                    [attr.aria-pressed]="selectedGroup()?.group_code === g.group_code"
                    (click)="selectGroup(g)"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-text-primary truncate">{{ g.name }}</p>
                        @if (selectable) {
                          <p class="text-xs text-text-secondary">
                            @if (cheapest(g); as c) {
                              @if (c.is_free_effective) {
                                Gratis
                              } @else {
                                desde {{ money(c.effective_price) }}
                              }
                            }
                          </p>
                        } @else {
                          <p class="text-xs text-text-secondary">Borrador — publica el plan para asignarlo</p>
                        }
                      </div>
                      <div class="flex flex-wrap justify-end gap-1">
                        @if (isCurrentGroup(g)) {
                          <app-badge variant="primary" size="xs">Actual</app-badge>
                        }
                        @if (selectable && cheapest(g)?.is_free_effective) {
                          <app-badge variant="neutral" size="xs">Gratis</app-badge>
                        }
                        @if (g.is_popular) {
                          <app-badge variant="neutral" size="xs" badgeStyle="outline">Popular</app-badge>
                        }
                      </div>
                    </div>
                    @if (selectable) {
                      <div class="flex flex-wrap gap-1">
                        @for (c of activeCycles(g); track c.plan_id) {
                          <span
                            class="px-2 py-0.5 text-xs rounded-md border border-border bg-background text-text-secondary"
                          >
                            {{ cycleLabel(c.billing_cycle) }}
                          </span>
                        }
                      </div>
                    }
                  </button>
                }
              </div>
            </section>
          }
        </div>

        <div class="space-y-3 min-w-0 lg:sticky lg:top-0">
          @if (selectedGroup(); as sg) {
            <div class="space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-text-secondary">Ciclo de facturación</p>
              <div class="flex flex-wrap gap-2" role="group" aria-label="Ciclo de facturación">
                @for (c of sg.cycles; track c.plan_id) {
                  @let isDraft = c.state !== 'active';
                  <button
                    type="button"
                    class="min-h-[44px] px-3 py-1.5 rounded-lg border text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                    [class]="
                      selectedPlanId() === c.plan_id
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-border bg-surface text-text-primary hover:border-primary/40'
                    "
                    [class.opacity-50]="isDraft"
                    [class.cursor-not-allowed]="isDraft"
                    [disabled]="isDraft"
                    [attr.title]="isDraft ? 'Borrador' : null"
                    [attr.aria-pressed]="selectedPlanId() === c.plan_id"
                    (click)="selectCycle(c)"
                  >
                    <span class="block font-medium">{{ cycleLabel(c.billing_cycle) }}</span>
                    <span class="block text-xs text-text-secondary">
                      {{ c.is_free_effective ? 'Gratis' : money(c.effective_price) }}
                    </span>
                    @if (!isDraft && savings(sg, c); as pct) {
                      <span class="block text-xs text-text-secondary">Ahorra {{ pct }}%</span>
                    }
                  </button>
                }
              </div>
              @if (selectedCycle()?.is_current) {
                <p class="flex items-start gap-2 text-xs text-text-secondary">
                  <app-icon name="info" [size]="14" class="mt-0.5 flex-shrink-0"></app-icon>
                  Es el plan vigente: se renovará el período desde la fecha de inicio.
                </p>
              }
            </div>
          }
          <app-plan-detail-panel
            [group]="selectedGroup()"
            [cycle]="selectedCycle()"
            [current]="current()"
          ></app-plan-detail-panel>
        </div>
      </div>
    }
  `,
})
export class PlanCatalogStepComponent {
  private readonly currencyService = inject(CurrencyFormatService);

  readonly groups = input<ActivatePlanGroupOption[]>([]);
  readonly current = input<ActivatePlanCurrentSubscription | null>(null);
  readonly loading = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly selectedPlanId = model<number | null>(null);
  readonly retry = output<void>();

  readonly skeletonRows = [0, 1, 2, 3];
  readonly search = signal('');
  readonly showDrafts = signal(false);
  /** Grupo elegido cuando aun no hay ciclo (plan_id) que lo determine. */
  private readonly localGroupCode = signal<string | null>(null);

  readonly selectedGroup = computed<ActivatePlanGroupOption | null>(() => {
    const groups = this.groups();
    const planId = this.selectedPlanId();
    if (planId !== null) {
      const byPlan = groups.find((g) => g.cycles?.some((c) => c.plan_id === planId));
      if (byPlan) return byPlan;
    }
    const code = this.localGroupCode();
    return code ? (groups.find((g) => g.group_code === code) ?? null) : null;
  });

  readonly selectedCycle = computed<ActivatePlanCycleOption | null>(() => {
    const planId = this.selectedPlanId();
    if (planId === null) return null;
    return this.selectedGroup()?.cycles?.find((c) => c.plan_id === planId) ?? null;
  });

  readonly sections = computed<CatalogSection[]>(() => {
    const q = normalizeText(this.search());
    const drafts = this.showDrafts();
    const visible = [...this.groups()]
      .filter((g) => drafts || this.hasActive(g))
      .filter((g) => {
        if (!q) return true;
        const haystack = [g.name, g.group_code, ...(g.cycles ?? []).map((c) => c.code)]
          .map((s) => normalizeText(s ?? ''))
          .join(' ');
        return haystack.includes(q);
      })
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    return SECTION_DEFS.map((def) => ({
      ...def,
      groups: visible.filter((g) => this.sectionKey(g.plan_type) === def.key),
    })).filter((s) => s.groups.length > 0);
  });

  readonly emptyTitle = computed(() => {
    const q = this.search().trim();
    return q ? `Sin resultados para «${q}»` : 'No hay planes activos para asignar';
  });

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value ?? '');
  }

  selectGroup(group: ActivatePlanGroupOption): void {
    const active = this.activeCycles(group);
    if (active.length === 0) return;
    this.localGroupCode.set(group.group_code);
    const target = active.find((c) => c.is_current) ?? active[0];
    this.selectedPlanId.set(target.plan_id);
  }

  selectCycle(cycle: ActivatePlanCycleOption): void {
    if (cycle.state !== 'active') return;
    this.selectedPlanId.set(cycle.plan_id);
  }

  activeCycles(group: ActivatePlanGroupOption): ActivatePlanCycleOption[] {
    return (group.cycles ?? []).filter((c) => c.state === 'active');
  }

  hasActive(group: ActivatePlanGroupOption): boolean {
    return this.activeCycles(group).length > 0;
  }

  cheapest(group: ActivatePlanGroupOption): ActivatePlanCycleOption | null {
    const active = this.activeCycles(group);
    if (active.length === 0) return null;
    return active.reduce((min, c) =>
      (Number(c.effective_price) || 0) < (Number(min.effective_price) || 0) ? c : min,
    );
  }

  isCurrentGroup(group: ActivatePlanGroupOption): boolean {
    return (group.cycles ?? []).some((c) => c.is_current);
  }

  /** Ahorro entero (%) frente a pagar el ciclo mensual durante los mismos meses. */
  savings(group: ActivatePlanGroupOption, cycle: ActivatePlanCycleOption): number {
    const months = CYCLE_MONTHS[cycle.billing_cycle];
    if (!months || months <= 1) return 0;
    const monthly = group.cycles?.find((c) => c.billing_cycle === 'monthly' && c.state === 'active');
    const monthlyPrice = monthly ? Number(monthly.effective_price) || 0 : 0;
    if (monthlyPrice <= 0) return 0;
    const pct = 1 - (Number(cycle.effective_price) || 0) / (monthlyPrice * months);
    return pct > 0 ? Math.round(pct * 100) : 0;
  }

  money(value: string | null | undefined): string {
    return this.currencyService.format(Number(value) || 0);
  }

  cycleLabel(cycle: string | null | undefined): string {
    return planCycleLabel(cycle);
  }

  private sectionKey(planType: string): string {
    return planType === 'base' || planType === 'promotional' || planType === 'partner_custom'
      ? planType
      : 'other';
  }
}
