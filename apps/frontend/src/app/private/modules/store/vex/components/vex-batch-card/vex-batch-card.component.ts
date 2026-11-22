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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, exhaustMap, takeUntil, timer } from 'rxjs';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  VexUiBlock,
  VexWriteBatch,
  VexWriteBatchBlockData,
  VexWriteBatchStatus,
  VexWriteBatchStep,
  VexWriteBatchStepStatus,
} from '../../models/vex.models';
import { VexApiService } from '../../services/vex-api.service';
import { VEX_COPY } from '../../vex-copy';

const POLL_MS = 1000;

const TERMINAL_BATCH: readonly VexWriteBatchStatus[] = [
  'applied',
  'partially_applied',
  'failed',
  'unknown_effect',
  'rejected',
  'expired',
];

const SETTLED_STEP: readonly VexWriteBatchStepStatus[] = [
  'applied',
  'failed',
  'unknown',
  'skipped',
  'unselected',
  'cancelled',
  'compensated',
  'compensation_failed',
];

interface StepGroup {
  domain: string;
  steps: VexWriteBatchStep[];
}

/**
 * `write_batch` block: one card that approves up to 25 reversible writes with
 * a single click. The block only carries the batch id; the card always reads
 * the real state from the server, so a reload keeps it faithful.
 *
 * Approval is synchronous on the server (returns when the batch is terminal),
 * so progress comes from polling `GET` every second while the request is in
 * flight. Polling stops on terminal state, when the request settles, and on
 * destroy.
 */
@Component({
  selector: 'vendix-vex-batch-card',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-primary bg-surface p-3 flex flex-col gap-3 min-w-0"
      role="group"
      [attr.aria-label]="copy.label"
      [attr.aria-busy]="busy()"
    >
      @if (batch(); as b) {
        <header class="flex items-start gap-2">
          <span
            class="w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-primary/15 text-primary"
            aria-hidden="true"
          >
            <app-icon name="sparkles" [size]="18"></app-icon>
          </span>
          <div class="min-w-0 flex-1">
            <h4 class="text-sm font-semibold text-text-primary m-0 break-words">
              {{ b.goal }}
            </h4>
            <p class="text-xs text-text-secondary m-0">
              @if (b.part_total > 1) {
                {{ copy.part(b.part_index, b.part_total) }} ·
              }
              {{ copy.changes_count(b.step_count) }}
            </p>
          </div>
        </header>

        @for (group of groups(); track group.domain) {
          <div class="flex flex-col gap-1">
            <p
              class="text-xs font-medium uppercase tracking-wide text-text-secondary m-0"
            >
              {{ group.domain }}
            </p>
            <ul class="list-none m-0 p-0 flex flex-col gap-1.5">
              @for (step of group.steps; track step.step_id) {
                <li
                  class="rounded-xl border border-border bg-background px-2.5 py-2 flex items-start gap-2"
                >
                  <input
                    type="checkbox"
                    class="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    [id]="inputId(step)"
                    [checked]="isChecked(step)"
                    [disabled]="!is_proposed() || busy()"
                    [attr.aria-label]="copy.select_step(step.label)"
                    (change)="toggle(step.step_id)"
                  />
                  <div class="min-w-0 flex-1 flex flex-col gap-1">
                    <label
                      class="text-sm text-text-primary break-words"
                      [attr.for]="inputId(step)"
                    >
                      {{ step.label }}
                    </label>
                    @if (step.preview.target) {
                      <p class="text-xs text-text-secondary m-0 break-words">
                        {{ step.preview.target }}
                      </p>
                    }
                    @for (change of step.preview.changes; track change.field) {
                      <p class="text-xs text-text-primary m-0 break-words">
                        <span class="text-text-secondary">{{ change.label }}:</span>
                        {{ show(change.from) }}
                        <span aria-hidden="true">→</span>
                        <span class="sr-only">a</span>
                        <strong class="font-semibold">{{ show(change.to) }}</strong>
                      </p>
                    }
                    @if (step.preview.message) {
                      <p class="text-xs text-text-secondary m-0">
                        {{ step.preview.message }}
                      </p>
                    }
                    @if (!is_proposed()) {
                      <p
                        class="text-xs m-0 inline-flex items-center gap-1"
                        [class]="statusClass(step.status)"
                      >
                        <app-icon
                          [name]="statusIcon(step.status)"
                          [size]="14"
                          class="motion-reduce:animate-none"
                          [class.animate-spin]="isTransient(step.status)"
                        ></app-icon>
                        {{ statusLabel(step.status) }}
                      </p>
                      @if (step.error) {
                        <p class="text-xs text-error m-0" role="alert">
                          {{ step.error }}
                        </p>
                      } @else if (step.result_summary) {
                        <p class="text-xs text-text-secondary m-0">
                          {{ step.result_summary }}
                        </p>
                      }
                      @if (step.status === 'applied') {
                        @if (step.can_undo) {
                          <div>
                            <app-button
                              variant="outline"
                              size="sm"
                              [loading]="undoing() === step.step_id"
                              [showTextWhileLoading]="true"
                              [disabled]="undoing() !== null"
                              (clicked)="undo(step)"
                            >
                              {{
                                undoing() === step.step_id
                                  ? copy.undoing
                                  : copy.undo
                              }}
                            </app-button>
                          </div>
                        } @else {
                          <p class="text-xs text-text-secondary m-0">
                            {{ copy.not_reversible }}
                          </p>
                        }
                      }
                    }
                  </div>
                </li>
              }
            </ul>
          </div>
        }

        <div aria-live="polite" class="flex flex-col gap-1.5">
          @if (b.status === 'executing') {
            <p class="text-xs text-text-secondary m-0" role="status">
              {{ copy.progress(done_count(), run_total()) }}
            </p>
          }
          @if (b.summary && !is_proposed() && b.status !== 'executing') {
            <p class="text-sm font-semibold text-text-primary m-0">
              {{ b.summary.message }}
            </p>
            <p class="text-xs text-text-secondary m-0">
              {{
                copy.counts(
                  b.summary.applied,
                  b.summary.failed + b.summary.unknown,
                  b.summary.skipped
                )
              }}
            </p>
          }
          @if (b.status === 'rejected') {
            <p class="text-sm text-text-secondary m-0" role="note">
              {{ copy.rejected }}
            </p>
          } @else if (b.status === 'expired') {
            <p class="text-sm text-text-secondary m-0" role="note">
              {{ copy.expired }}
            </p>
          } @else if (b.status === 'unknown_effect') {
            <p class="text-xs text-error m-0" role="alert">
              {{ copy.unknown_effect }}
            </p>
          }
          @if (undo_hint(); as hint) {
            <p class="text-xs text-text-secondary m-0">{{ hint }}</p>
          }
        </div>

        @if (is_proposed() || (busy() && b.status === 'executing')) {
          <footer class="flex flex-col gap-2 sm:flex-row">
            <app-button
              class="flex-1"
              variant="outline-danger"
              [fullWidth]="true"
              [disabled]="busy()"
              (clicked)="reject()"
            >
              {{ copy.cancel }}
            </app-button>
            <app-button
              class="flex-1"
              variant="primary"
              [fullWidth]="true"
              [loading]="busy()"
              [showTextWhileLoading]="true"
              [disabled]="busy() || selected_count() === 0"
              (clicked)="approve()"
            >
              {{ busy() ? copy.applying : approve_label() }}
            </app-button>
          </footer>
          @if (selected_count() === 0 && !busy()) {
            <p class="text-xs text-text-secondary m-0" role="note">
              {{ copy.none_selected }}
            </p>
          }
        }
      } @else if (load_error()) {
        <p class="text-sm text-error m-0" role="alert">{{ copy.load_failed }}</p>
        <div>
          <app-button variant="outline" size="sm" (clicked)="load()">
            {{ copy.retry }}
          </app-button>
        </div>
      } @else {
        <p class="text-sm text-text-secondary m-0" role="status">
          {{ copy.loading }}
        </p>
      }
    </section>
  `,
})
export class VexBatchCardComponent {
  private readonly api = inject(VexApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly copy = VEX_COPY.blocks.write_batch;

  readonly block = input.required<VexUiBlock>();

  protected readonly batch = signal<VexWriteBatch | null>(null);
  protected readonly load_error = signal(false);
  protected readonly busy = signal(false);
  protected readonly undoing = signal<string | null>(null);
  private readonly selected = signal<ReadonlySet<string>>(new Set());

  private readonly stop_polling = new Subject<void>();

  private readonly batch_id = computed(
    () => (this.block().data as unknown as VexWriteBatchBlockData).batch_id,
  );

  protected readonly is_proposed = computed(
    () => this.batch()?.status === 'proposed',
  );

  protected readonly groups = computed<StepGroup[]>(() => {
    const steps = this.batch()?.steps ?? [];
    const map = new Map<string, VexWriteBatchStep[]>();
    for (const step of steps) {
      const key =
        step.preview.domain?.trim() || step.tool || this.copy.other_domain;
      const list = map.get(key) ?? [];
      list.push(step);
      map.set(key, list);
    }
    return [...map.entries()].map(([domain, list]) => ({
      domain,
      steps: list,
    }));
  });

  protected readonly selected_count = computed(() => this.selected().size);

  protected readonly approve_label = computed(() => {
    const total = this.batch()?.steps.length ?? 0;
    const k = this.selected_count();
    return k === total ? this.copy.approve_all : this.copy.approve_selected(k);
  });

  /** Steps that were part of the run (not unticked). */
  protected readonly run_total = computed(
    () =>
      (this.batch()?.steps ?? []).filter((s) => s.status !== 'unselected')
        .length,
  );

  protected readonly done_count = computed(
    () =>
      (this.batch()?.steps ?? []).filter(
        (s) => s.status !== 'unselected' && SETTLED_STEP.includes(s.status),
      ).length,
  );

  protected readonly undo_hint = computed(() => {
    const b = this.batch();
    if (!b?.undo_until || !b.steps.some((s) => s.can_undo)) return '';
    const date = new Date(b.undo_until);
    if (Number.isNaN(date.getTime())) return '';
    return this.copy.undo_until(
      new Intl.DateTimeFormat('es', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date),
    );
  });

  constructor() {
    effect(() => {
      this.batch_id();
      untracked(() => this.load());
    });
    this.destroyRef.onDestroy(() => this.stop_polling.next());
  }

  protected load(): void {
    const id = this.batch_id();
    if (!id) return;
    this.load_error.set(false);
    this.api
      .getBatch(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batch) => {
          this.apply(batch);
          // Reloaded mid-run: follow it until it settles.
          if (batch.status === 'executing') this.startPolling();
        },
        error: () => this.load_error.set(true),
      });
  }

  protected inputId(step: VexWriteBatchStep): string {
    return `vex-batch-${this.batch_id()}-${step.step_id}`;
  }

  protected isChecked(step: VexWriteBatchStep): boolean {
    if (this.is_proposed()) return this.selected().has(step.step_id);
    return step.status !== 'unselected' && step.status !== 'cancelled';
  }

  protected toggle(stepId: string): void {
    if (!this.is_proposed() || this.busy()) return;
    const next = new Set(this.selected());
    if (next.has(stepId)) next.delete(stepId);
    else next.add(stepId);
    this.selected.set(next);
  }

  protected approve(): void {
    const id = this.batch_id();
    const ids = (this.batch()?.steps ?? [])
      .filter((s) => this.selected().has(s.step_id))
      .map((s) => s.step_id);
    if (this.busy() || !id || ids.length === 0) return;
    this.busy.set(true);
    this.startPolling();
    this.api
      .approveBatch(id, ids)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ batch }) => {
          this.finish();
          this.apply(batch);
        },
        error: (error: unknown) => {
          this.finish();
          this.toast.error(
            parseApiError(error).userMessage,
            this.copy.approve_failed,
          );
          // The server may have run part of it: show the real state.
          this.refresh();
        },
      });
  }

  protected reject(): void {
    const id = this.batch_id();
    if (this.busy() || !id) return;
    this.busy.set(true);
    this.api
      .rejectBatch(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ batch }) => {
          this.busy.set(false);
          this.apply(batch);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.toast.error(
            parseApiError(error).userMessage,
            this.copy.reject_failed,
          );
          this.refresh();
        },
      });
  }

  protected undo(step: VexWriteBatchStep): void {
    const id = this.batch_id();
    if (this.undoing() !== null || !id) return;
    this.undoing.set(step.step_id);
    this.api
      .undoBatchStep(id, step.step_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batch) => {
          this.undoing.set(null);
          this.apply(batch);
        },
        error: (error: unknown) => {
          this.undoing.set(null);
          this.toast.error(
            parseApiError(error).userMessage,
            this.copy.undo_failed,
          );
          this.refresh();
        },
      });
  }

  protected show(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return this.copy.empty_value;
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  protected statusLabel(status: VexWriteBatchStepStatus): string {
    return this.copy.status[status] ?? status;
  }

  protected isTransient(status: VexWriteBatchStepStatus): boolean {
    return status === 'running' || status === 'compensating';
  }

  protected statusIcon(status: VexWriteBatchStepStatus): string {
    switch (status) {
      case 'applied':
        return 'circle-check';
      case 'failed':
      case 'compensation_failed':
        return 'x-circle';
      case 'unknown':
        return 'help-circle';
      case 'running':
      case 'compensating':
        return 'loader';
      case 'compensated':
        return 'rotate-ccw';
      case 'skipped':
      case 'unselected':
      case 'cancelled':
        return 'minus-circle';
      default:
        return 'clock';
    }
  }

  protected statusClass(status: VexWriteBatchStepStatus): string {
    switch (status) {
      case 'applied':
        return 'text-success';
      case 'failed':
      case 'compensation_failed':
      case 'unknown':
        return 'text-error';
      default:
        return 'text-text-secondary';
    }
  }

  private apply(batch: VexWriteBatch): void {
    const first = this.batch() === null;
    this.batch.set(batch);
    if (batch.status === 'proposed' && (first || this.selected().size === 0)) {
      this.selected.set(new Set(batch.steps.map((s) => s.step_id)));
    }
    if (TERMINAL_BATCH.includes(batch.status)) this.stop_polling.next();
  }

  private finish(): void {
    this.stop_polling.next();
    this.busy.set(false);
  }

  private refresh(): void {
    const id = this.batch_id();
    if (!id) return;
    this.api
      .getBatch(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batch) => {
          this.apply(batch);
          // The approve request failed (network, proxy timeout) while the
          // server keeps running the batch: follow it until it settles, like
          // a reload mid-run does in `load()`.
          if (batch.status === 'executing') this.startPolling();
        },
      });
  }

  /** Polls `GET` every second until terminal, `finish()` or destroy. */
  private startPolling(): void {
    this.stop_polling.next();
    const id = this.batch_id();
    timer(POLL_MS, POLL_MS)
      .pipe(
        exhaustMap(() => this.api.getBatch(id)),
        takeUntil(this.stop_polling),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (batch) => {
          // Never regress a settled card with a late poll response.
          if (batch.status === 'executing' || TERMINAL_BATCH.includes(batch.status)) {
            this.apply(batch);
          }
        },
        error: () => undefined,
      });
  }
}
