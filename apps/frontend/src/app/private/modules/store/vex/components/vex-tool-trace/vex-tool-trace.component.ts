import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { VexToolStep } from '../../models/vex.models';

/**
 * Collapsible live trace of a Vex turn: which tools ran, in which order, and
 * how each one ended. Collapsed once the turn settles so a long plan does not
 * push the answer off screen; reopenable at any time.
 */
@Component({
  selector: 'vendix-vex-tool-trace',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps().length > 0) {
      <div
        class="rounded-xl border border-[var(--color-border)] bg-[rgba(var(--color-text-primary-rgb,0,0,0),0.03)]"
      >
        <button
          type="button"
          class="w-full min-h-10 px-3 flex items-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          [attr.aria-expanded]="open()"
          (click)="toggle()"
        >
          <app-icon name="info" [size]="14"></app-icon>
          <span class="font-medium">
            {{ running_count() > 0 ? 'Vex está trabajando' : 'Actividad de Vex' }}
            ({{ steps().length }})
          </span>
          <app-icon
            name="chevron-down"
            [size]="14"
            class="ml-auto transition-transform"
            [class.rotate-180]="open()"
          ></app-icon>
        </button>
        @if (open()) {
          <ol class="px-3 pb-2 flex flex-col">
            @for (step of steps(); track step.id) {
              <li class="flex items-start gap-2 py-1 text-xs">
                <span
                  class="mt-0.5 shrink-0"
                  [class.text-[var(--color-primary)]]="step.status === 'running'"
                  [class.text-[var(--color-success)]]="step.status === 'done'"
                  [class.text-[var(--color-error)]]="step.status === 'failed'"
                  aria-hidden="true"
                >
                  @switch (step.status) {
                    @case ('running') {
                      <app-icon name="loader-2" [size]="14" [spin]="true"></app-icon>
                    }
                    @case ('failed') {
                      <app-icon name="x-circle" [size]="14"></app-icon>
                    }
                    @default {
                      <app-icon name="check-circle" [size]="14"></app-icon>
                    }
                  }
                </span>
                <div class="min-w-0">
                  <p class="font-medium text-[var(--color-text-primary)]">
                    {{ humanize(step.name) }}
                  </p>
                  @if (step.summary) {
                    <p class="text-[var(--color-text-secondary)] leading-relaxed">
                      {{ step.summary }}
                    </p>
                  }
                </div>
              </li>
            }
          </ol>
        }
      </div>
    }
  `,
})
export class VexToolTraceComponent {
  readonly steps = input<VexToolStep[]>([]);
  readonly open = signal(false);

  readonly running_count = computed(
    () => this.steps().filter((s) => s.status === 'running').length,
  );

  toggle(): void {
    this.open.update((v) => !v);
  }

  humanize(name: string): string {
    const spaced = name.replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
}
