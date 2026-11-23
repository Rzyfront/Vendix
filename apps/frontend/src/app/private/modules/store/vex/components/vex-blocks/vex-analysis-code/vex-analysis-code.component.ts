import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { VexAnalysisInfo, VexUiBlock } from '../../../models/vex.models';
import { VEX_COPY } from '../../../vex-copy';

const COPIED_MS = 1800;

/**
 * Collapsed disclosure under a block whose `spec.analysis` carries the Python
 * used to compute its figures. Renders nothing for blocks without analysis.
 */
@Component({
  selector: 'vendix-vex-analysis-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (analysis(); as a) {
      <details class="rounded-xl border border-border bg-text-primary/5 min-w-0">
        <summary
          class="min-h-10 px-3 flex items-center cursor-pointer text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          {{ copy.summary }}
        </summary>
        <div class="px-3 pb-3 flex flex-col gap-2 min-w-0">
          <div class="flex justify-end">
            <button
              type="button"
              class="min-h-10 px-3 text-xs rounded-lg border border-border text-text-secondary hover:text-text-primary"
              [attr.aria-label]="copy.copy_aria"
              (click)="copyCode(a.source)"
            >
              {{ copied() ? copy.copied : copy.copy }}
            </button>
          </div>
          <pre
            class="max-h-80 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs font-mono text-text-primary"
            tabindex="0"
            [attr.aria-label]="copy.code_aria"
          ><code>{{ a.source }}</code></pre>
          <p class="text-xs text-text-secondary">{{ copy.caption }}</p>
        </div>
      </details>
    }
  `,
})
export class VexAnalysisCodeComponent {
  readonly block = input.required<VexUiBlock>();

  protected readonly copy = VEX_COPY.analysis;
  protected readonly copied = signal(false);
  protected readonly analysis = computed<VexAnalysisInfo | null>(() => {
    const spec = this.block().spec;
    const analysis = spec && 'analysis' in spec ? spec.analysis : undefined;
    return analysis?.source ? analysis : null;
  });

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected async copyCode(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    this.copied.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), COPIED_MS);
  }
}
