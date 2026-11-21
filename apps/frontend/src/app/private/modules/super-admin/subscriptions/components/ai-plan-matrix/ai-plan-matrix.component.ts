import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AI_AGENT_KEYS,
  AI_AGENT_LABELS,
  AI_CAP_PERIOD_LABELS,
  AI_CAP_UNIT_LABELS,
  AICapabilityDefinition,
  AIAgentKey,
  AIEntitlement,
  AIOnLimit,
  aiCapAcceptsZero,
  aiCapabilityHasCap,
  aiCapabilityId,
  aiCapabilitiesForAgent,
  describeAIEntitlements,
} from '../../../../../../shared/constants/ai-capabilities';
import {
  ConfirmationModalComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../shared/components';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { completeAIEntitlements } from '../../utils/ai-feature-flags.util';

export interface AIPlanMatrixPlanOption {
  id: string;
  name: string;
}

interface AIRowView {
  id: string;
  def: AICapabilityDefinition;
  row: AIEntitlement;
  showSwitch: boolean;
  showCap: boolean;
  /** Visually disabled because the agent row of its card is off. */
  locked: boolean;
  unlimited: boolean;
  inputValue: string;
  unitText: string;
  /** Lowest value the input takes, in its display unit (0 only where a 0 is enforced). */
  minDisplay: number;
  capHint: string;
}

interface AICardView {
  agent: AIAgentKey;
  title: string;
  rows: AIRowView[];
}

const ON_LIMIT_OPTIONS: { value: AIOnLimit; label: string }[] = [
  { value: 'block', label: 'Bloquear' },
  { value: 'warn', label: 'Avisar' },
];

/**
 * Plan AI configuration (odd/tasks/vex-agente-avanzado.md §3.11, T12): one card
 * per agent (Vex, Vexi) plus the platform card, built ONLY from the catalog
 * `AI_CAPABILITIES`. The model is always the COMPLETE list of rows, so saving
 * never drops a capability. Voice is stored in seconds and typed in minutes.
 */
@Component({
  selector: 'app-ai-plan-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ToggleComponent, InputComponent, SelectorComponent, IconComponent, ConfirmationModalComponent],
  template: `
    <div class="space-y-5" data-testid="ai-plan-matrix">
      <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div class="space-y-1">
          <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
            Capacidades de IA del plan
          </h2>
          <p class="text-sm text-text-secondary">
            Enciende lo que incluye el plan y fija sus cupos. Una fila apagada no pide cupo.
          </p>
        </div>
        @if (otherPlans().length > 0) {
          <div class="w-full md:w-64">
            <app-selector
              label="Copiar de otro plan"
              placeholder="Elige un plan"
              size="sm"
              [options]="planOptions()"
              [value]="copyPickerValue()"
              (valueChange)="onPickCopySource($event)"
            ></app-selector>
          </div>
        }
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        @for (card of cards(); track card.agent) {
          <section
            class="p-4 bg-surface rounded-lg border border-border space-y-4"
            [attr.aria-labelledby]="'ai-card-' + card.agent"
          >
            <h3 [id]="'ai-card-' + card.agent" class="text-base font-semibold text-text-primary">
              {{ card.title }}
            </h3>

            @for (item of card.rows; track item.id) {
              <div
                class="space-y-3 pt-3 first:pt-0 border-t border-border first:border-t-0"
                [class.opacity-50]="item.locked"
                [attr.data-testid]="'ai-row-' + item.id"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-0.5 min-w-0">
                    <p class="text-sm font-medium text-text-primary">{{ item.def.label }}</p>
                    <p class="text-xs text-text-secondary">{{ item.def.description }}</p>
                  </div>
                  @if (item.showSwitch) {
                    <app-toggle
                      [checked]="item.row.enabled"
                      [disabled]="item.locked"
                      [ariaLabel]="card.title + ': ' + item.def.label"
                      (toggled)="setEnabled(item.id, $event)"
                    ></app-toggle>
                  }
                </div>

                @if (item.showCap) {
                  <div class="space-y-2">
                    <div class="grid grid-cols-[1fr_auto] gap-3 items-end">
                      <app-input
                        type="number"
                        [label]="item.unitText"
                        [min]="item.minDisplay"
                        [helperText]="item.capHint"
                        [disabled]="item.locked || item.unlimited"
                        [ngModel]="item.inputValue"
                        (ngModelChange)="setCap(item.def, $event)"
                      ></app-input>
                      <label class="flex items-center gap-2 pb-3 text-sm text-text-primary cursor-pointer">
                        <input
                          type="checkbox"
                          class="h-4 w-4 rounded border-border accent-[var(--color-primary)]"
                          [checked]="item.unlimited"
                          [disabled]="item.locked"
                          [attr.aria-label]="item.def.label + ': sin límite'"
                          (change)="setUnlimited(item.def, $any($event.target).checked)"
                        />
                        <span>Sin límite</span>
                      </label>
                    </div>
                    <app-selector
                      label="Al llegar al tope"
                      size="sm"
                      [options]="onLimitOptions"
                      [value]="item.row.on_limit"
                      [disabled]="item.locked"
                      (valueChange)="setOnLimit(item.def, $event)"
                    ></app-selector>
                  </div>
                }
              </div>
            }
          </section>
        }
      </div>

      <section class="rounded-lg border border-border bg-background p-4 space-y-2" aria-labelledby="ai-summary-title">
        <h3 id="ai-summary-title" class="text-sm font-semibold text-text-primary uppercase tracking-wide">
          Resumen del plan
        </h3>
        <ul class="space-y-1 text-sm text-text-secondary" data-testid="ai-plan-summary">
          @for (line of summary(); track line) {
            <li>{{ line }}</li>
          }
        </ul>
      </section>
    </div>

    @if (pendingCopy(); as pending) {
      <app-confirmation-modal
        title="Copiar capacidades de IA"
        [message]="'Se reemplazarán las capacidades de IA de este plan por las del plan «' + pending.name + '». Aún no se guarda nada.'"
        confirmText="Copiar"
        (confirm)="confirmCopy(pending.id)"
        (cancel)="cancelCopy()"
        (isOpenChange)="onConfirmOpenChange($event)"
      ></app-confirmation-modal>
    }
  `,
})
export class AIPlanMatrixComponent {
  /** The complete list of rows (one per catalog entry, catalog order). */
  readonly entitlements = model<AIEntitlement[]>([]);
  /** Other plans that «Copiar de otro plan» can read from. */
  readonly otherPlans = input<AIPlanMatrixPlanOption[]>([]);
  /** Emitted after the confirmation: the parent loads that plan and sets the rows. */
  readonly copyFromPlan = output<string>();

  readonly onLimitOptions = ON_LIMIT_OPTIONS;
  readonly pendingCopy = signal<AIPlanMatrixPlanOption | null>(null);
  readonly copyPickerValue = signal<string | null>(null);

  readonly planOptions = computed(() =>
    this.otherPlans().map((plan) => ({ value: plan.id, label: plan.name })),
  );

  private readonly complete = computed(() => completeAIEntitlements(this.entitlements()));

  readonly summary = computed(() => describeAIEntitlements(this.complete()));

  readonly cards = computed<AICardView[]>(() => {
    const byId = new Map(
      this.complete().map((row) => [aiCapabilityId(row.agent_key, row.capability_key), row]),
    );
    return AI_AGENT_KEYS.map((agent) => {
      const defs = aiCapabilitiesForAgent(agent);
      const agentRow = byId.get(aiCapabilityId(agent, 'agent'));
      const agentOff = agentRow !== undefined && !agentRow.enabled;
      const rows = defs.map((def): AIRowView => {
        const id = aiCapabilityId(def.agent_key, def.capability_key);
        const row = byId.get(id)!;
        const hasCap = aiCapabilityHasCap(def);
        const showSwitch = def.kind !== 'cap';
        const unlimited = row.cap_value === null;
        const zeroOk = aiCapAcceptsZero(def, row.on_limit);
        return {
          id,
          def,
          row,
          showSwitch,
          showCap: hasCap && (!showSwitch || row.enabled),
          locked: agentOff && def.capability_key !== 'agent',
          unlimited,
          inputValue: unlimited ? '' : String(this.toDisplay(def, row.cap_value as number)),
          unitText: this.unitText(def),
          minDisplay: zeroOk ? 0 : this.toDisplay(def, this.minPositiveCap(def)),
          capHint: unlimited
            ? ''
            : row.cap_value === 0
              ? '0 = no permite usarlo'
              : def.kind === 'cap'
                ? 'Para no permitirlo, apaga el agente.'
                : '',
        };
      });
      return { agent, title: AI_AGENT_LABELS[agent], rows };
    });
  });

  setEnabled(id: string, enabled: boolean): void {
    this.patch(id, { enabled });
  }

  setUnlimited(def: AICapabilityDefinition, unlimited: boolean): void {
    // Unchecking starts from the lowest cap the plan can enforce: an explicit 0
    // («nada») where a 0 blocks a switched capability, otherwise the minimum.
    const id = aiCapabilityId(def.agent_key, def.capability_key);
    this.patch(id, { cap_value: unlimited ? null : this.lowestCap(def, this.rowOf(id).on_limit) });
  }

  setCap(def: AICapabilityDefinition, text: string | number | null): void {
    const id = aiCapabilityId(def.agent_key, def.capability_key);
    const lowest = this.lowestCap(def, this.rowOf(id).on_limit);
    const typed = Number(text === null || text === '' ? Number.NaN : text);
    const stored = Number.isFinite(typed) ? this.fromDisplay(def, Math.max(0, typed)) : lowest;
    this.patch(id, { cap_value: Math.max(lowest, stored) });
  }

  setOnLimit(def: AICapabilityDefinition, value: string | number | null): void {
    if (value !== 'block' && value !== 'warn') return;
    const id = aiCapabilityId(def.agent_key, def.capability_key);
    const cap = this.rowOf(id).cap_value;
    // A 0 is only enforced while it blocks: switching to «avisar» lifts it to the minimum.
    this.patch(id, {
      on_limit: value,
      ...(cap !== null ? { cap_value: Math.max(this.lowestCap(def, value), cap) } : {}),
    });
  }

  onPickCopySource(value: string | number | null): void {
    if (value === null || value === '') return;
    const plan = this.otherPlans().find((p) => p.id === String(value));
    if (!plan) return;
    this.pendingCopy.set(plan);
  }

  confirmCopy(planId: string): void {
    this.pendingCopy.set(null);
    this.copyPickerValue.set(null);
    this.copyFromPlan.emit(planId);
  }

  /** Closing the dialog with its own close button or Escape cancels the copy. */
  onConfirmOpenChange(open: boolean): void {
    if (!open && this.pendingCopy()) this.cancelCopy();
  }

  cancelCopy(): void {
    this.pendingCopy.set(null);
    this.copyPickerValue.set(null);
  }

  private patch(id: string, change: Partial<AIEntitlement>): void {
    this.entitlements.set(
      completeAIEntitlements(this.entitlements()).map((row) =>
        aiCapabilityId(row.agent_key, row.capability_key) === id ? { ...row, ...change } : row,
      ),
    );
  }

  private rowOf(id: string): AIEntitlement {
    return this.complete().find((row) => aiCapabilityId(row.agent_key, row.capability_key) === id)!;
  }

  /** Lowest stored cap a save accepts (mirrors the backend `aiCapAcceptsZero` check). */
  private lowestCap(def: AICapabilityDefinition, onLimit: AIEntitlement['on_limit']): number {
    return aiCapAcceptsZero(def, onLimit) ? 0 : this.minPositiveCap(def);
  }

  /** One unit as shown: one minute of voice, otherwise one message, token or record. */
  private minPositiveCap(def: AICapabilityDefinition): number {
    return def.cap_unit === 'seconds' ? 60 : 1;
  }

  /** Voice is stored in seconds and shown in minutes. */
  private toDisplay(def: AICapabilityDefinition, stored: number): number {
    return def.cap_unit === 'seconds' ? Math.round((stored / 60) * 100) / 100 : stored;
  }

  private fromDisplay(def: AICapabilityDefinition, shown: number): number {
    return def.cap_unit === 'seconds' ? Math.round(shown * 60) : Math.floor(shown);
  }

  private unitText(def: AICapabilityDefinition): string {
    if (!def.cap_unit || !def.cap_period) return '';
    const unit = def.cap_unit === 'seconds' ? 'minutos' : AI_CAP_UNIT_LABELS[def.cap_unit];
    return `${unit} ${AI_CAP_PERIOD_LABELS[def.cap_period]}`;
  }
}
