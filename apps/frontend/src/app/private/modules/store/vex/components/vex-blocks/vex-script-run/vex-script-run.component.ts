import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VexScriptRun, VexUiBlock } from '../../../models/vex.models';
import { VexApiService } from '../../../services/vex-api.service';
import { VEX_COPY } from '../../../vex-copy';

/**
 * «Ver cómo lo calculé» under a block computed by a Code Mode script (F10).
 * Collapsed by default; opening fetches the owner endpoint once. Read-only:
 * the code is shown only when the server returns it (owner + 7-day window),
 * otherwise the server's Spanish reason is shown with the call summary.
 */
@Component({
  selector: 'vendix-vex-script-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (runId(); as id) {
      <div class="rounded-xl border border-border bg-text-primary/5 min-w-0">
        <button
          type="button"
          class="w-full min-h-10 px-3 flex items-center text-xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary rounded-xl"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="'vex-script-run-' + id"
          (click)="toggle(id)"
        >
          {{ copy.summary }}
        </button>
        @if (open()) {
          <div
            class="px-3 pb-3 flex flex-col gap-2 min-w-0"
            [id]="'vex-script-run-' + id"
            aria-live="polite"
          >
            @if (loading()) {
              <p class="text-xs text-text-secondary">{{ copy.loading }}</p>
            }
            @if (failed()) {
              <p class="text-xs text-error">{{ copy.error }}</p>
            }
            @if (run(); as r) {
              @if (r.source) {
                <pre
                  class="max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs font-mono text-text-primary"
                  tabindex="0"
                  [attr.aria-label]="copy.code_aria"
                ><code>{{ r.source }}</code></pre>
              } @else if (r.source_hidden_reason) {
                <p class="text-xs text-text-secondary">
                  {{ r.source_hidden_reason }}
                </p>
              }
              <p class="text-xs text-text-secondary">{{ meta() }}</p>
              @if (r.calls.length > 0) {
                <div class="overflow-x-auto">
                  <table class="w-full text-xs text-left">
                    <caption class="text-left font-medium text-text-secondary pb-1">
                      {{ copy.calls_title }}
                    </caption>
                    <thead class="text-text-secondary">
                      <tr>
                        <th scope="col" class="pr-3 py-1 font-medium">{{ copy.col_tool }}</th>
                        <th scope="col" class="pr-3 py-1 font-medium">{{ copy.col_status }}</th>
                        <th scope="col" class="pr-3 py-1 font-medium text-right">{{ copy.col_rows }}</th>
                        <th scope="col" class="py-1 font-medium text-right">{{ copy.col_ms }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of r.calls; track c.seq) {
                        <tr class="border-t border-border">
                          <td class="pr-3 py-1 font-mono text-text-primary">{{ c.tool }}</td>
                          <td class="pr-3 py-1">{{ statusLabel(c.status) }}</td>
                          <td class="pr-3 py-1 text-right">{{ c.rows ?? '—' }}</td>
                          <td class="py-1 text-right">
                            {{ c.duration_ms === null ? '—' : c.duration_ms + ' ms' }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              <p class="text-xs text-text-secondary">{{ copy.caption }}</p>
            }
          </div>
        }
      </div>
    }
  `,
})
export class VexScriptRunComponent {
  readonly block = input.required<VexUiBlock>();

  protected readonly copy = VEX_COPY.script_run;
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly run = signal<VexScriptRun | null>(null);

  private readonly api = inject(VexApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Only blocks computed by a Code Mode (`js`) script carry a run to open. */
  protected readonly runId = computed<string | null>(() => {
    const spec = this.block().spec;
    const analysis = spec && 'analysis' in spec ? spec.analysis : undefined;
    return analysis?.language === 'js' && analysis.run_id
      ? analysis.run_id
      : null;
  });

  protected readonly meta = computed(() => {
    const r = this.run();
    if (!r) return '';
    const parts: string[] = [];
    if (r.rounds) parts.push(this.copy.rounds(r.rounds));
    if (r.duration_ms !== null) parts.push(this.copy.duration(r.duration_ms));
    return parts.join(' · ');
  });

  protected statusLabel(status: string): string {
    if (status === 'denied') return this.copy.status_denied;
    return status === 'ok' ? this.copy.status_ok : this.copy.status_failed;
  }

  protected toggle(id: string): void {
    const next = !this.open();
    this.open.set(next);
    if (!next || this.run() || this.loading()) return;
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .getScriptRun(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.run.set(run);
          this.loading.set(false);
        },
        error: () => {
          this.failed.set(true);
          this.loading.set(false);
        },
      });
  }
}
