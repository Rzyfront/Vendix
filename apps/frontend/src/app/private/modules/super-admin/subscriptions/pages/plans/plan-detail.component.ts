import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import {
  AI_FEATURE_KEYS,
  AIFeatureKey,
  PlanFeatureLineage,
  SubscriptionPlan,
} from '../../interfaces/subscription-admin.interface';
import {
  AI_FEATURE_CATEGORY_LABELS,
  AIAgent,
  AIEngineApp,
  AIToolCatalogEntry,
} from '../../../ai-engine/interfaces';
import { AIEngineService } from '../../../ai-engine/services/ai-engine.service';
import { formatFeatureCap } from '../../utils/ai-feature-flags.util';
import {
  PlanIncludedItem,
  normalizeIncludedItems,
} from '../../../../../../shared/utils/plan-features.util';
import {
  ButtonComponent,
  IconComponent,
  BadgeComponent,
  CardComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-plan-detail',
  standalone: true,
  imports: [RouterModule, ButtonComponent, IconComponent, BadgeComponent, CardComponent, CurrencyPipe],
  template: `
    <div class="w-full max-w-4xl mx-auto">
      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando...</p>
        </div>
      } @else if (plan()) {
        <div class="flex items-center gap-3 mb-6">
          <button
            type="button"
            class="p-2 rounded-lg hover:bg-gray-100 text-text-secondary"
            (click)="router.navigate(['/super-admin/subscriptions/plans'])"
          >
            <app-icon name="arrow-left" [size]="20"></app-icon>
          </button>
          <h1 class="text-xl font-semibold text-text-primary">{{ plan()!.name }}</h1>
          <div class="flex gap-2">
            @if (plan()!.is_active) {
              <app-badge variant="success" size="sm">Activo</app-badge>
            } @else {
              <app-badge variant="neutral" size="sm">Inactivo</app-badge>
            }
          </div>
          <div class="flex-1"></div>
          <app-button
            variant="outline"
            size="sm"
            (clicked)="router.navigate(['/super-admin/subscriptions/plans', plan()!.id, 'edit'])"
          >
            <app-icon name="edit" [size]="16" slot="icon" ></app-icon>
            Editar
          </app-button>
        </div>

        <app-card [responsive]="true" [padding]="false">
          <div class="p-4 md:p-6 space-y-6">
            <div>
              <h2 class="text-sm font-medium text-text-secondary mb-1">Slug</h2>
              <p class="text-text-primary">{{ plan()!.slug }}</p>
            </div>

            <div>
              <h2 class="text-sm font-medium text-text-secondary mb-1">Descripción</h2>
              <p class="text-text-primary">{{ plan()!.description }}</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h2 class="text-sm font-medium text-text-secondary mb-1">Visibilidad</h2>
                <p class="text-text-primary">{{ plan()!.is_public ? 'Público' : 'Privado' }}</p>
              </div>
              <div>
                <h2 class="text-sm font-medium text-text-secondary mb-1">Período de gracia</h2>
                <p class="text-text-primary">{{ plan()!.grace_threshold_days }} días</p>
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">Precios</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (p of plan()!.pricing; track p.id) {
                  <div class="p-3 bg-background rounded-lg border border-border">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm font-medium text-text-primary capitalize">{{ p.billing_cycle }}</span>
                      @if (p.is_default) {
                        <app-badge variant="primary" size="sm">Por defecto</app-badge>
                      }
                    </div>
                    <p class="text-lg font-semibold text-text-primary">{{ p.price | currency }}</p>
                  </div>
                }
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">Incluye</h2>
              <div class="space-y-2">
                @for (item of includedItems(); track item.key) {
                  <div
                    class="flex items-start gap-2 text-sm p-2 rounded-lg bg-background border border-border"
                  >
                    <app-icon
                      [name]="itemIcon(item)"
                      [size]="16"
                      class="mt-0.5 shrink-0"
                      [class.text-green-500]="item.enabled && !item.is_limited"
                      [class.text-amber-500]="item.enabled && item.is_limited"
                      [class.text-gray-400]="!item.enabled"
                    ></app-icon>
                    <div class="flex-1 min-w-0">
                      <div
                        class="text-text-primary"
                        [class.line-through]="!item.enabled"
                        [class.text-text-secondary]="!item.enabled"
                      >
                        {{ item.label }}
                      </div>
                      @if (itemValue(item)) {
                        <div class="text-xs text-text-secondary">{{ itemValue(item) }}</div>
                      }
                    </div>
                  </div>
                } @empty {
                  <div
                    class="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-center text-sm text-text-secondary"
                  >
                    Este plan aún no declara ítems incluidos.
                  </div>
                }
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">Funciones de IA</h2>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                @for (entry of aiFlagEntries(); track entry[0]) {
                  <div
                    class="flex items-start gap-2 text-sm p-2 rounded-lg"
                    [class.bg-green-50]="entry[1]?.enabled"
                    [class.bg-gray-50]="!entry[1]?.enabled"
                  >
                    <app-icon
                      [name]="entry[1]?.enabled ? 'check' : 'x'"
                      [size]="16"
                      [class.text-green-500]="entry[1]?.enabled"
                      [class.text-gray-400]="!entry[1]?.enabled"
                    ></app-icon>
                    <div class="flex-1 min-w-0">
                      <div class="text-text-primary capitalize truncate">{{ formatFeatureKey(entry[0]) }}</div>
                      @if (entry[1]?.enabled && getFeatureCapLabel(entry[1])) {
                        <div class="text-xs text-text-secondary truncate">{{ getFeatureCapLabel(entry[1]) }}</div>
                      }
                    </div>
                  </div>
                } @empty {
                  <div class="col-span-full text-center text-text-secondary text-sm py-4">
                    Sin funciones IA configuradas
                  </div>
                }
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-1">Linaje IA (catálogo vivo)</h2>
              <p class="text-xs text-text-secondary mb-3">
                De qué aplicación y modelo bebe cada función: plan → app → modelo activo.
              </p>
              <div class="space-y-3">
                @for (row of featureLineage(); track row.feature) {
                  <div class="p-3 bg-background rounded-lg border border-border space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium text-text-primary">{{ featureLabel(row.feature) }}</span>
                      <div class="flex items-center gap-2">
                        @if (row.capLabel) {
                          <span class="text-xs text-text-secondary">{{ row.capLabel }}</span>
                        }
                        @if (!row.enabled) {
                          <app-badge variant="warning" size="sm">Apagada con enlaces</app-badge>
                        }
                      </div>
                    </div>

                    <div class="space-y-1.5">
                      @for (app of row.apps; track app.key) {
                        <div class="flex items-center justify-between gap-2 text-sm">
                          <span class="text-text-primary truncate" [title]="app.key">{{ app.name }}</span>
                          <div class="flex items-center gap-2 shrink-0">
                            @if (!app.isActive) {
                              <app-badge variant="neutral" size="sm">App inactiva</app-badge>
                            }
                            <span class="text-xs text-text-secondary truncate">
                              {{ app.modelLabel ?? 'config por defecto del Engine' }}
                            </span>
                          </div>
                        </div>
                      } @empty {
                        <p class="text-xs text-amber-600">
                          Sin aplicaciones vivas en esta categoría.
                        </p>
                      }
                    </div>

                    @if (row.agents.length > 0) {
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs text-text-secondary">Agentes:</span>
                        @for (agent of row.agents; track agent.key) {
                          @if (agent.missing) {
                            <app-badge variant="error" size="sm">rota: {{ agent.key }}</app-badge>
                          } @else {
                            <app-badge variant="primary" size="sm">{{ agent.name ?? agent.key }}</app-badge>
                          }
                        }
                      </div>
                    }

                    @if (row.tools.length > 0) {
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs text-text-secondary">Tools:</span>
                        @for (tool of row.tools; track tool.name) {
                          @if (tool.missing) {
                            <app-badge variant="error" size="sm">rota: {{ tool.name }}</app-badge>
                          } @else {
                            <app-badge variant="neutral" size="sm">{{ tool.name }}</app-badge>
                          }
                        }
                      </div>
                    }
                  </div>
                } @empty {
                  <div class="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-center text-sm text-text-secondary">
                    Este plan no habilita funciones IA.
                  </div>
                }
              </div>
            </div>

            <div>
              <h2 class="text-sm font-semibold text-text-primary mb-3">Configuración</h2>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div class="p-3 bg-background rounded-lg border border-border">
                  <div class="text-text-secondary text-xs mb-1">Tipo</div>
                  <div class="font-medium text-text-primary capitalize">{{ plan()?.['plan_type'] ?? '—' }}</div>
                </div>
                <div class="p-3 bg-background rounded-lg border border-border">
                  <div class="text-text-secondary text-xs mb-1">Gracia suave</div>
                  <div class="font-medium text-text-primary">{{ plan()?.grace_threshold_days ?? 0 }} días</div>
                </div>
                <div class="p-3 bg-background rounded-lg border border-border">
                  <div class="text-text-secondary text-xs mb-1">Estado</div>
                  <div class="font-medium text-text-primary">{{ plan()?.is_active ? 'Activo' : 'Inactivo' }}</div>
                </div>
              </div>
            </div>
          </div>
        </app-card>
      }
    </div>
  `,
})
export class PlanDetailComponent {
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  readonly router = inject(Router);
  private service = inject(SubscriptionAdminService);
  private aiEngineService = inject(AIEngineService);

  readonly plan = signal<SubscriptionPlan | null>(null);
  readonly loading = signal(true);
  /** F6 — catálogo vivo para resolver el linaje plan→app→modelo. */
  readonly engineApps = signal<AIEngineApp[]>([]);
  readonly engineAgents = signal<AIAgent[]>([]);
  readonly engineTools = signal<AIToolCatalogEntry[]>([]);

  /**
   * F6 — una fila por feature habilitada (o con refs declaradas aunque esté
   * apagada, para que una referencia vieja siga visible en lugar de
   * desaparecer en silencio): apps vivas de la categoría con su modelo
   * activo, agentes enlazados y tools enlazadas, marcando las rotas.
   */
  readonly featureLineage = computed<PlanFeatureLineage[]>(() => {
    const flags = (this.plan()?.ai_feature_flags as Record<string, any>) ?? {};
    const agentByKey = new Map(this.engineAgents().map((agent) => [agent.key, agent]));
    const liveTools = new Set(this.engineTools().map((tool) => tool.name));
    const topAgents = toStringList(flags['agents_allowed']);
    const topTools = toStringList(flags['tools_allowed']);
    const rows: PlanFeatureLineage[] = [];

    for (const key of AI_FEATURE_KEYS) {
      const config = (flags[key] as Record<string, any> | undefined) ?? {};
      const agents = dedupe([
        ...toStringList(config['agents_allowed']),
        ...(key === 'tool_agents' ? topAgents : []),
      ]).map((agentKey) => ({
        key: agentKey,
        name: agentByKey.get(agentKey)?.name ?? null,
        missing: !agentByKey.has(agentKey),
      }));
      const tools = dedupe([
        ...toStringList(config['tools_allowed']),
        ...(key === 'tool_agents' ? topTools : []),
      ]).map((name) => ({ name, missing: !liveTools.has(name) }));
      const enabled = config['enabled'] === true;
      if (!enabled && agents.length === 0 && tools.length === 0) continue;

      rows.push({
        feature: key,
        enabled,
        capLabel: formatFeatureCap(config),
        apps: this.engineApps()
          .filter((app) => app.ai_feature_category === key)
          .map((app) => ({
            key: app.key,
            name: app.name,
            isActive: app.is_active,
            modelLabel: app.config ? `${app.config.label} · ${app.config.model_id}` : null,
          })),
        agents,
        tools,
      });
    }
    return rows;
  });

  /** Lista «incluye» en sólo lectura. Acepta el arreglo canónico y la forma
   *  de objeto legada, normalizando ambas al mismo shape. */
  readonly includedItems = computed<PlanIncludedItem[]>(() =>
    normalizeIncludedItems(this.plan()?.feature_matrix),
  );

  readonly aiFlagEntries = computed(() => {
    const flags = (this.plan()?.ai_feature_flags as Record<string, any>) ?? {};
    return Object.entries(flags);
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadPlan(id);
    }
    this.loadCatalog();
  }

  /** F6 — catálogo vivo; si falla, el linaje marca todo como no resuelto. */
  loadCatalog(): void {
    this.aiEngineService
      .getApps({ page: 1, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => this.engineApps.set(res?.data ?? []),
        error: () => this.engineApps.set([]),
      });
    this.aiEngineService
      .getAgents({ page: 1, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => this.engineAgents.set(res?.data ?? []),
        error: () => this.engineAgents.set([]),
      });
    this.aiEngineService
      .getTools()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = res?.data ?? res ?? [];
          this.engineTools.set(Array.isArray(data) ? data : []);
        },
        error: () => this.engineTools.set([]),
      });
  }

  featureLabel(key: AIFeatureKey): string {
    return AI_FEATURE_CATEGORY_LABELS[key] ?? this.formatFeatureKey(key);
  }

  loadPlan(id: string): void {
    this.loading.set(true);
    this.service.getPlanById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success) this.plan.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  formatFeatureKey(key: string): string {
    return key.replace(/_/g, ' ');
  }

  getFeatureCapLabel(value: any): string {
    return formatFeatureCap(value);
  }

  itemIcon(item: PlanIncludedItem): 'check' | 'minus-circle' | 'x' {
    if (!item.enabled) return 'x';
    return item.is_limited ? 'minus-circle' : 'check';
  }

  itemValue(item: PlanIncludedItem): string {
    if (item.value) return item.value;
    if (typeof item.limit === 'number') {
      return item.unit ? `${item.limit} ${item.unit}` : String(item.limit);
    }
    return '';
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
