import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ToggleComponent,
} from '../../../../../../../../shared/components/index';
import type { InputType } from '../../../../../../../../shared/components/input/input.component';
import { WorkflowFieldDef, WorkflowStageDef } from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { AiStepTestResult } from '../../../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../../../services/workflows-api.service';
import { toWorkflowError } from '../../../../utils/workflow-errors.util';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import {
  AI_TEST_MAX_CHARS,
  aiConfigHints,
  buildTestData,
  confidenceText,
  formatOutputValue,
  testDataSize,
} from './stage-ai-config.utils';

/**
 * "Probar paso de IA": one sample input per field the step reads, then the real
 * answer of the AI. The server tests the SAVED draft, so unsaved edits block it.
 */
@Component({
  selector: 'app-stage-ai-test',
  standalone: true,
  imports: [FormsModule, AlertBannerComponent, BadgeComponent, ButtonComponent, IconComponent, InputComponent, ToggleComponent],
  template: `
    <section class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" aria-label="Probar paso de IA" data-testid="ai-test">
      <h4 class="text-sm font-bold text-text-primary">Probar paso de IA</h4>

      @if (inputFields().length > 0) {
        <div class="flex flex-col gap-2">
          <p class="text-xs font-semibold text-text-primary">Datos de ejemplo</p>
          @for (field of inputFields(); track field.key) {
            @if (field.type === 'boolean') {
              <app-toggle [label]="field.label || field.key" [checked]="sampleFlag(field.key)" (toggled)="setSample(field.key, $event)" />
            } @else {
              <app-input
                size="sm"
                [label]="field.label || field.key"
                [type]="inputType(field)"
                [ngModel]="sampleText(field.key)"
                (ngModelChange)="setSample(field.key, $event)"
              />
            }
          }
        </div>
      }

      @if (blocker(); as reason) {
        <p class="text-xs text-text-secondary" data-testid="ai-test-blocker">{{ reason }}</p>
      }
      @if (tooLong()) {
        <p class="text-xs font-semibold text-error" role="alert">Los datos de ejemplo superan los {{ maxChars }} caracteres.</p>
      }

      <div class="flex flex-wrap items-center gap-3">
        <app-button variant="outline" size="sm" [loading]="busy()" [disabled]="!!blocker() || tooLong()" (clicked)="run()">
          <app-icon name="sparkles" [size]="14" slot="icon" />
          Probar paso de IA
        </app-button>
        <span class="text-xs text-text-secondary">Usa cupo de IA del plan.</span>
      </div>

      @if (failure(); as message) {
        <app-alert-banner variant="danger" icon="alert-circle">{{ message }}</app-alert-banner>
      }

      @if (result(); as r) {
        @if (r.status === 'success') {
          <div class="flex flex-col gap-2 rounded-xl border border-border bg-background p-3" data-testid="ai-test-success">
            <app-badge variant="success">Respuesta real de la IA</app-badge>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              @for (row of outputRows(r.values); track row.key) {
                <dt class="font-semibold text-text-secondary">{{ row.label }}</dt>
                <dd class="whitespace-pre-wrap break-words text-text-primary">{{ row.value }}</dd>
              }
            </dl>
            @if (confidenceLabel(r.confidence); as confidence) {
              <p class="text-xs text-text-primary" data-testid="ai-test-confidence">Confianza: {{ confidence }}</p>
            }
            @if (r.reason) {
              <p class="text-xs text-text-secondary">Motivo: {{ r.reason }}</p>
            }
            <p class="text-xs text-text-secondary">
              @if (r.model) { Modelo: {{ r.model }} · }
              {{ r.tokens }} tokens usados
            </p>
          </div>
        } @else {
          <app-alert-banner [variant]="r.status === 'failed' ? 'danger' : 'warning'" icon="alert-circle">
            <span data-testid="ai-test-message">{{ r.message }}</span>
          </app-alert-banner>
        }
      }
    </section>
  `,
})
export class StageAiTestComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly store = inject(WorkflowEditorStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly stage = input.required<WorkflowStageDef>();

  readonly maxChars = AI_TEST_MAX_CHARS;
  readonly busy = signal(false);
  readonly result = signal<AiStepTestResult | null>(null);
  readonly failure = signal('');
  private readonly samples = signal<Record<string, string | boolean>>({});

  private readonly fields = computed(() => this.store.draft()?.fields ?? []);
  readonly inputFields = computed<WorkflowFieldDef[]>(() => {
    const keys = this.stage().ai?.inputs ?? [];
    return keys
      .map((key) => this.fields().find((f) => f.key === key))
      .filter((f): f is WorkflowFieldDef => !!f);
  });
  private readonly data = computed(() => buildTestData(this.fields(), this.stage().ai?.inputs ?? [], this.samples()));
  readonly tooLong = computed(() => testDataSize(this.data()) > AI_TEST_MAX_CHARS);

  /** Why the button is disabled; `null` when the step can be tested. */
  readonly blocker = computed<string | null>(() => {
    const ai = this.stage().ai;
    if (!ai || aiConfigHints(ai).length > 0) return 'Completa las instrucciones, los campos que lee y el que escribe para probar este paso.';
    if (this.store.dirty() || this.store.savingNow()) return 'Guarda el borrador para probar este paso.';
    if (this.store.definitionId() === null) return 'Guarda el borrador para probar este paso.';
    return null;
  });

  sampleText(key: string): string {
    const v = this.samples()[key];
    return typeof v === 'string' ? v : '';
  }

  sampleFlag(key: string): boolean {
    return this.samples()[key] === true;
  }

  setSample(key: string, value: string | boolean | null): void {
    this.samples.update((current) => ({ ...current, [key]: value ?? '' }));
  }

  inputType(field: WorkflowFieldDef): InputType {
    if (field.type === 'number' || field.type === 'money') return 'number';
    if (field.type === 'date') return 'date';
    return 'text';
  }

  outputRows(values: Record<string, unknown>): { key: string; label: string; value: string }[] {
    return Object.entries(values).map(([key, value]) => {
      const field = this.fields().find((f) => f.key === key);
      // A list answer is stored as the option value; show its label.
      const option = field?.options?.find((o) => o.value === value);
      return {
        key,
        label: field?.label ?? key,
        value: option ? option.label : formatOutputValue(value),
      };
    });
  }

  confidenceLabel(confidence: number | null): string | null {
    return confidenceText(confidence);
  }

  run(): void {
    const id = this.store.definitionId();
    if (this.busy() || this.blocker() || this.tooLong() || id === null) return;
    this.busy.set(true);
    this.failure.set('');
    this.result.set(null);
    this.api
      .testAiStep(id, { stage_key: this.stage().key, data: this.data() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.result.set(res);
        },
        error: (e) => {
          this.busy.set(false);
          this.failure.set(toWorkflowError(e).message);
        },
      });
  }
}
