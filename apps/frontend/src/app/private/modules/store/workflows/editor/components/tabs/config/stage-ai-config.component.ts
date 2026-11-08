import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../../../shared/components/index';
import {
  WORKFLOW_AI_TASKS,
  WORKFLOW_LIMITS,
  WorkflowAiDef,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { WorkflowEditorStore } from '../../../workflow-editor.store';
import { FIELD_TYPE_TEXT, toWholeNumber } from '../../../workflow-editor.utils';
import { StageAiTestComponent } from './stage-ai-test.component';
import {
  AI_ERROR_THEN_OPTIONS,
  AI_TASK_OPTIONS,
  aiConfigHints,
  allowedConfidenceFields,
  allowedInputFields,
  allowedOutputFields,
  isSingleOutputTask,
  maxOutputsFor,
  withAiReview,
  withTask,
} from './stage-ai-config.utils';

const NO_CONFIDENCE = '__none__';

const EMPTY_AI: WorkflowAiDef = { task: 'classify', instructions: '', inputs: [], outputs: [] };

/** Configuración of a Paso de IA: task, instructions, fields it reads and writes, review and error policy. */
@Component({
  selector: 'app-stage-ai-config',
  standalone: true,
  imports: [FormsModule, InputComponent, MultiSelectorComponent, SelectorComponent, TextareaComponent, ToggleComponent, StageAiTestComponent],
  template: `
    <div class="flex flex-col gap-4">
      <p class="text-xs text-text-secondary">
        La IA lee campos de la solicitud y escribe el resultado en otros campos. Su respuesta se valida antes de guardarse.
      </p>

      <app-selector
        label="Tarea"
        [required]="true"
        [options]="taskOptions"
        [value]="ai().task"
        [helpText]="taskHint()"
        (valueChange)="setTask($event)"
      />

      <div class="flex flex-col gap-1">
        <app-textarea
          label="Instrucciones"
          [required]="true"
          [rows]="5"
          placeholder="Explica qué debe hacer la IA con los campos que lee."
          [error]="instructionsError()"
          [ngModel]="ai().instructions"
          (ngModelChange)="patch({ instructions: $event ?? '' })"
        />
        <span class="self-end text-xs" [class.text-error]="overLimit()" [class.text-text-secondary]="!overLimit()" data-testid="ai-instructions-counter">
          {{ ai().instructions.length }} / {{ maxInstructions }}
        </span>
      </div>

      <app-multi-selector
        label="Campos que lee"
        [required]="true"
        placeholder="Elige los campos que la IA lee"
        [options]="inputOptions()"
        [helpText]="'De 1 a ' + maxInputs + ' campos. No se pueden leer los de tipo Archivo ni Persona del equipo.'"
        [ngModel]="ai().inputs"
        (ngModelChange)="setInputs($event)"
      />

      @if (single()) {
        <app-selector
          label="Campo que escribe"
          [required]="true"
          placeholder="Elige el campo donde escribe la IA"
          [options]="outputOptions()"
          [value]="singleOutput()"
          [helpText]="outputHint()"
          (valueChange)="setSingleOutput($event)"
        />
      } @else {
        <app-multi-selector
          label="Campos que escribe"
          [required]="true"
          placeholder="Elige los campos que llena la IA"
          [options]="outputOptions()"
          [helpText]="outputHint()"
          [ngModel]="ai().outputs"
          (ngModelChange)="setOutputs($event)"
        />
      }

      @if (ai().task === 'decide') {
        <p class="rounded-xl bg-primary/5 p-3 text-xs text-text-primary" data-testid="ai-decide-hint">
          Las ramas son condiciones sobre el campo que escribe la IA: defínelas en la pestaña Transiciones y deja una rama por defecto.
        </p>
      }

      <app-selector
        label="Guardar la confianza en (opcional)"
        placeholder="No guardar la confianza"
        [options]="confidenceOptions()"
        [value]="ai().confidence_field ?? noConfidence"
        helpText="Solo campos de tipo Número. La IA escribe un valor entre 0 y 1."
        (valueChange)="setConfidence($event)"
      />

      <div class="flex flex-col gap-1">
        <app-toggle label="Una persona revisa el resultado" [checked]="ai().review === true" (toggled)="setReview($event)" />
        <p class="text-xs text-text-secondary">
          Quien revisa puede editar lo que escribió la IA y luego aprueba o rechaza. Necesita un responsable: elígelo en la pestaña Responsable.
          Sin revisión, el paso avanza solo.
        </p>
      </div>

      <fieldset class="flex flex-col gap-3 rounded-xl border border-border p-3">
        <legend class="px-1 text-xs font-semibold text-text-primary">Si la IA falla</legend>
        <app-input
          label="Reintentos"
          type="number"
          min="0"
          [max]="maxRetries"
          [helperText]="'De 0 a ' + maxRetries + '. Se reintenta con espera creciente.'"
          [ngModel]="ai().on_error?.retries ?? maxRetries"
          (ngModelChange)="setRetries($event)"
        />
        <app-selector
          label="Después de los reintentos"
          [options]="thenOptions"
          [value]="ai().on_error?.then ?? 'continue'"
          (valueChange)="setThen($event)"
        />
        @if (ai().on_error?.then === 'route') {
          <app-selector
            label="Etapa de destino"
            [required]="true"
            placeholder="Elige la etapa"
            [options]="routeOptions()"
            [value]="ai().on_error?.route_to ?? null"
            (valueChange)="setRouteTo($event)"
          />
        }
        <p class="text-xs text-text-secondary">
          Siempre se avisa al dueño del flujo. Con revisión humana, la persona llena el resultado a mano.
        </p>
      </fieldset>

      @if (hints().length > 0) {
        <ul class="list-disc pl-5 text-xs text-warning" data-testid="ai-hints">
          @for (hint of hints(); track hint) { <li>{{ hint }}</li> }
        </ul>
      }

      <app-stage-ai-test [stage]="stage()" />
    </div>
  `,
})
export class StageAiConfigComponent {
  protected readonly store = inject(WorkflowEditorStore);
  readonly stage = input.required<WorkflowStageDef>();

  readonly taskOptions = AI_TASK_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  readonly thenOptions = AI_ERROR_THEN_OPTIONS;
  readonly noConfidence = NO_CONFIDENCE;
  readonly maxInstructions = WORKFLOW_LIMITS.maxAiInstructions;
  readonly maxInputs = WORKFLOW_LIMITS.maxAiInputs;
  readonly maxRetries = WORKFLOW_LIMITS.maxActionRetries;

  readonly ai = computed<WorkflowAiDef>(() => this.stage().ai ?? EMPTY_AI);
  readonly fields = computed(() => this.store.draft()?.fields ?? []);
  readonly single = computed(() => isSingleOutputTask(this.ai().task));
  /** The one output of a single-output task, or null while none is chosen. */
  readonly singleOutput = computed<string | null>(() => this.ai().outputs.at(0) ?? null);
  readonly overLimit = computed(() => this.ai().instructions.length > this.maxInstructions);
  readonly instructionsError = computed(() =>
    this.overLimit() ? `Máximo ${this.maxInstructions} caracteres.` : undefined,
  );
  readonly hints = computed(() => aiConfigHints(this.ai()));
  readonly taskHint = computed(() => AI_TASK_OPTIONS.find((o) => o.value === this.ai().task)?.hint ?? '');
  readonly outputHint = computed(() => {
    const max = maxOutputsFor(this.ai().task);
    return max === 1
      ? 'Escribe exactamente un campo, del tipo que admite la tarea.'
      : `De 1 a ${max} campos que llena la IA.`;
  });

  readonly inputOptions = computed(() => this.fieldOptions(allowedInputFields(this.fields(), this.ai())));
  readonly outputOptions = computed(() => this.fieldOptions(allowedOutputFields(this.fields(), this.ai())));
  readonly confidenceOptions = computed(() => [
    { value: NO_CONFIDENCE, label: 'No guardar la confianza' },
    ...this.fieldOptions(allowedConfidenceFields(this.fields(), this.ai())),
  ]);
  readonly routeOptions = computed(() =>
    (this.store.draft()?.stages ?? [])
      .filter((s) => s.key !== this.stage().key)
      .map((s) => ({ value: s.key, label: s.name })),
  );

  patch(change: Partial<WorkflowAiDef>): void {
    this.update((ai) => ({ ...ai, ...change }));
  }

  setTask(value: string | number | null): void {
    const task = WORKFLOW_AI_TASKS.find((t) => t === value);
    if (task) this.update((ai) => withTask(ai, task, this.fields()));
  }

  setInputs(values: (string | number)[] | null): void {
    this.patch({ inputs: (values ?? []).map(String).slice(0, this.maxInputs) });
  }

  setSingleOutput(value: string | number | null): void {
    this.patch({ outputs: value === null || value === '' ? [] : [String(value)] });
  }

  setOutputs(values: (string | number)[] | null): void {
    this.patch({ outputs: (values ?? []).map(String).slice(0, maxOutputsFor(this.ai().task)) });
  }

  setConfidence(value: string | number | null): void {
    this.update((ai) => {
      const { confidence_field: _previous, ...rest } = ai;
      return value === null || value === NO_CONFIDENCE ? rest : { ...rest, confidence_field: String(value) };
    });
  }

  setReview(review: boolean): void {
    this.store.updateStage(this.stage().key, (s) => withAiReview(s, review));
  }

  setRetries(raw: unknown): void {
    const retries = toWholeNumber(raw);
    this.update((ai) => ({
      ...ai,
      on_error: { ...ai.on_error, retries: retries === undefined ? undefined : Math.min(this.maxRetries, Math.max(0, retries)) },
    }));
  }

  setThen(value: string | number | null): void {
    const then = value === 'route' || value === 'fail' || value === 'continue' ? value : 'continue';
    this.update((ai) => {
      const { route_to: _route, ...policy } = ai.on_error ?? {};
      return { ...ai, on_error: { ...policy, then } };
    });
  }

  setRouteTo(value: string | number | null): void {
    this.update((ai) => ({
      ...ai,
      on_error: { ...ai.on_error, then: 'route', ...(value === null ? {} : { route_to: String(value) }) },
    }));
  }

  private update(change: (ai: WorkflowAiDef) => WorkflowAiDef): void {
    this.store.updateStage(this.stage().key, (s) => ({ ...s, ai: change(s.ai ?? EMPTY_AI) }));
  }

  private fieldOptions(fields: WorkflowFieldDef[]): { value: string; label: string }[] {
    return fields.map((f) => ({ value: f.key, label: `${f.label || f.key} · ${FIELD_TYPE_TEXT[f.type]}` }));
  }
}
