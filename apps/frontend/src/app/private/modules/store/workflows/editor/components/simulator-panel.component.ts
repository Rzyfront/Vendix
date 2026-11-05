import { Component, DestroyRef, computed, effect, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { STAGE_OUTCOMES } from '../../../../../../shared/workflows/contract/workflow-contract';
import { SimulatedAction, SimulationResult } from '../../interfaces/workflow.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import { WorkflowStageFormComponent } from '../../components/stage-form.component';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { END_OUTCOME_LABEL, outcomeText, stageFieldsOf } from '../workflow-editor.utils';
import { ACTION_MAP_KEY_LABEL, VENDIX_ACTION_LABEL } from '../workflow-editor-triggers.utils';

interface SimState {
  stage_key: string;
  data: Record<string, unknown>;
}

/** Step-by-step dry run against the backend simulator. Nothing is persisted or sent. */
@Component({
  selector: 'app-simulator-panel',
  standalone: true,
  imports: [
    FormsModule,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    ModalComponent,
    TextareaComponent,
    ToggleComponent,
    WorkflowStageFormComponent,
  ],
  template: `
    <app-modal [isOpen]="isOpen()" (isOpenChange)="isOpen.set($event)" title="Simular flujo" size="lg">
      <div class="relative flex flex-col gap-4">
        <div aria-hidden="true" class="pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center overflow-hidden text-6xl font-bold text-text-secondary/10 -rotate-12">
          SIMULACIÓN
        </div>
        <div class="relative z-10 flex flex-wrap items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 p-2" data-testid="sim-watermark">
          <app-badge variant="warning">SIMULACIÓN</app-badge>
          <span class="text-xs text-text-primary">No se crea ninguna solicitud, tarea ni aviso real.</span>
          <span class="flex-1"></span>
          <app-button variant="outline" size="sm" (clicked)="start()">
            <app-icon name="rotate-ccw" [size]="14" slot="icon" />
            Reiniciar
          </app-button>
        </div>

        @if (error(); as message) {
          <p class="relative z-10 text-sm text-error" role="alert">{{ message }}</p>
        }
        @if (invalid().length > 0) {
          <ul class="relative z-10 list-disc pl-5 text-sm text-error" role="alert">
            @for (line of invalid(); track $index) { <li>{{ line }}</li> }
          </ul>
        }

        @if (stage(); as current) {
          <section class="relative z-10 flex flex-col gap-3" [attr.aria-label]="'Etapa simulada ' + current.name">
            <h3 class="text-sm font-bold text-text-primary">Etapa actual: {{ current.name }}</h3>
            @if (current.type === 'end') {
              <p class="rounded-xl border border-border bg-surface p-3 text-sm font-semibold text-text-primary" data-testid="sim-end">
                Fin: {{ endText(current.outcome) }}
              </p>
            } @else if (current.type === 'automatic') {
              <p class="text-sm text-text-secondary">Etapa automática: avanza sola.</p>
            } @else {
              @if (fields().length > 0) {
                <app-workflow-stage-form
                  [fields]="fields()"
                  [instanceData]="state()?.data ?? {}"
                  [seedKey]="seedKey()"
                  [simulate]="true"
                />
              }
              @for (req of requirements(); track req.key) {
                <app-toggle
                  [label]="'Requisito cumplido: ' + req.label"
                  [checked]="satisfied().has(req.key)"
                  (toggled)="mark(req.key, $event)"
                />
              }
              <app-textarea label="Comentario (opcional)" [rows]="2" [ngModel]="comment()" (ngModelChange)="comment.set($event)" />
              <div class="flex flex-wrap gap-2" role="group" aria-label="Resultado de la etapa">
                @for (outcome of outcomes(); track outcome) {
                  <app-button [variant]="outcome === 'reject' ? 'outline-danger' : 'primary'" size="sm" [loading]="busy()" (clicked)="run(outcome)">
                    {{ text(outcome) }}
                  </app-button>
                }
              </div>
            }
          </section>
        }

        @if (last(); as res) {
          <section class="relative z-10 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" aria-label="Resultado de la simulación" data-testid="sim-result">
            @if (res.form_errors.length > 0) {
              <p class="text-sm font-semibold text-error">Faltan datos en el formulario:</p>
              <ul class="list-disc pl-5 text-xs text-text-primary">
                @for (e of res.form_errors; track $index) { <li>{{ e.message }}</li> }
              </ul>
            }
            @if (res.pending_requirements.length > 0) {
              <p class="text-sm font-semibold text-error">Requisitos pendientes:</p>
              <ul class="list-disc pl-5 text-xs text-text-primary">
                @for (r of res.pending_requirements; track r.key) { <li>{{ r.label }}</li> }
              </ul>
            }
            @if (res.comment_required) {
              <p class="text-sm font-semibold text-error">Este resultado exige un comentario.</p>
            }
            @if (res.no_transition) {
              <p class="text-sm font-semibold text-error">No hay una transición que aplique para este resultado.</p>
            }
            @if (res.loop_guard) {
              <p class="text-sm font-semibold text-warning">Se detuvo: las etapas automáticas parecen repetirse en bucle.</p>
            }
            @if (advanced()) {
              <p class="text-sm font-semibold text-text-primary">
                Destino: {{ res.to_stage?.name }}
                @if (res.transition?.when_text) { <span class="font-normal text-text-secondary"> (por condición)</span> }
              </p>
              <p class="text-xs text-text-secondary">Ruta: {{ pathText(res) }}</p>
              @if (res.tasks.length > 0) {
                <p class="text-xs font-semibold text-text-primary">Tareas que se crearían</p>
                <ul class="list-disc pl-5 text-xs text-text-primary">
                  @for (t of res.tasks; track $index) {
                    <li>{{ stageName(t.stage_key) }} → {{ t.assignee?.label ?? 'Sin responsable' }}</li>
                  }
                </ul>
              }
              @if (res.notifications.length > 0) {
                <p class="text-xs font-semibold text-text-primary">Avisos que se enviarían</p>
                <ul class="list-disc pl-5 text-xs text-text-primary">
                  @for (n of res.notifications; track $index) { <li>{{ n.to }}: {{ n.message }}</li> }
                </ul>
              }
              @if (res.actions && res.actions.length > 0) {
                <p class="text-xs font-semibold text-text-primary">Acciones de Vendix (no se ejecutan)</p>
                <ul class="list-disc pl-5 text-xs text-text-primary" data-testid="sim-actions">
                  @for (a of res.actions; track $index) {
                    <li>Se ejecutaría: {{ actionText(a) }}</li>
                  }
                </ul>
              }
              @if (res.ended) {
                <p class="text-sm font-bold text-text-primary">Fin: {{ endText(res.ended.outcome) }}</p>
              }
            }
          </section>
        }
      </div>
      <div slot="footer" class="flex w-full justify-end">
        <app-button variant="outline" (clicked)="isOpen.set(false)">Cerrar</app-button>
      </div>
    </app-modal>
  `,
})
export class SimulatorPanelComponent {
  private readonly api = inject(WorkflowsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(WorkflowEditorStore);
  private readonly form = viewChild(WorkflowStageFormComponent);

  readonly isOpen = model<boolean>(false);
  readonly definitionId = input.required<number>();

  readonly state = signal<SimState | null>(null);
  readonly last = signal<SimulationResult | null>(null);
  readonly steps = signal(0);
  readonly satisfied = signal<ReadonlySet<string>>(new Set());
  readonly comment = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly invalid = signal<string[]>([]);

  readonly stage = computed(() => {
    const key = this.state()?.stage_key;
    return this.store.draft()?.stages.find((s) => s.key === key) ?? null;
  });
  readonly fields = computed(() => {
    const draft = this.store.draft();
    const stage = this.stage();
    return draft && stage ? stageFieldsOf(draft, stage) : [];
  });
  readonly requirements = computed(() => this.stage()?.requirements ?? []);
  readonly outcomes = computed(() => {
    const stage = this.stage();
    return stage ? STAGE_OUTCOMES[stage.type] : [];
  });
  readonly seedKey = computed(() => `${this.state()?.stage_key ?? ''}#${this.steps()}`);
  readonly advanced = computed(() => {
    const r = this.last();
    return !!r && r.valid && r.form_errors.length === 0 && r.pending_requirements.length === 0 &&
      !r.comment_required && !r.no_transition && r.to_stage !== null;
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) untracked(() => this.start());
    });
  }

  text(outcome: string): string {
    return outcomeText(outcome);
  }

  endText(outcome: string | undefined): string {
    return END_OUTCOME_LABEL[outcome ?? 'completed'] ?? String(outcome);
  }

  stageName(key: string): string {
    return this.store.draft()?.stages.find((s) => s.key === key)?.name ?? key;
  }

  actionText(a: SimulatedAction): string {
    const label = VENDIX_ACTION_LABEL[a.action] ?? a.action;
    const detail = Object.entries(a.map_resolved ?? {})
      .filter(([, v]) => typeof v !== 'object')
      .map(([k, v]) => `${ACTION_MAP_KEY_LABEL[k] ?? k}: ${v}`)
      .join(', ');
    return detail ? `${label} (${detail})` : label;
  }

  pathText(res: SimulationResult): string {
    return res.path.map((k) => this.stageName(k)).join(' → ');
  }

  mark(key: string, on: boolean): void {
    this.satisfied.update((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Starts (or restarts) with no `state`: the backend returns the first stage. */
  start(): void {
    this.callSimulator({}, true);
  }

  run(outcome: string): void {
    const state = this.state();
    if (!state) return;
    let values: Record<string, unknown> = {};
    if (outcome !== 'reject' && outcome !== 'return' && this.fields().length > 0) {
      const collected = this.form()?.collect();
      if (collected && !collected.ok) return;
      values = collected?.values ?? {};
    }
    this.callSimulator(
      {
        state,
        outcome,
        values,
        ...(this.comment().trim() ? { comment: this.comment().trim() } : {}),
        satisfied_requirements: [...this.satisfied()],
      },
      false,
    );
  }

  private callSimulator(
    body: { state?: SimState; outcome?: string; values?: Record<string, unknown>; comment?: string; satisfied_requirements?: string[] },
    reset: boolean,
  ): void {
    this.busy.set(true);
    this.error.set(null);
    this.invalid.set([]);
    this.api
      .simulate(this.definitionId(), { definition: this.store.draft(), ...body })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.busy.set(false);
        this.last.set(res);
        if (!res.valid) {
          this.state.set(null);
          this.invalid.set(res.issues.map((i) => i.message));
          return;
        }
        for (const e of res.form_errors) this.form()?.fail(e.field, e.message);
        const ok = res.form_errors.length === 0 && res.pending_requirements.length === 0 &&
          !res.comment_required && !res.no_transition && res.to_stage !== null;
        if (!ok) return;
        this.state.set({ stage_key: res.to_stage!.key, data: res.data });
        this.satisfied.set(new Set());
        this.comment.set('');
        this.steps.update((n) => (reset ? 0 : n + 1));
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(toWorkflowError(e).message);
      },
    });
  }
}
