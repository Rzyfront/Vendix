import {
  Component,
  ChangeDetectionStrategy,
  ContentChild,
  TemplateRef,
  computed,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { TimelineStep, TimelineSize, TimelineStepStatus } from './timeline.interfaces';

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './timeline.component.html',
  styleUrls: ['./timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineComponent {
  // ── Inputs ──────────────────────────────────────────────────
  readonly steps = input.required<TimelineStep[]>();
  readonly collapsible = input<boolean>(true);
  readonly expand_label = input<string>('Ver timeline completo');
  readonly collapse_label = input<string>('Ocultar timeline');
  readonly size = input<TimelineSize>('md');

  // ── Template projection ─────────────────────────────────────
  @ContentChild('stepTemplate') step_template?: TemplateRef<{
    $implicit: TimelineStep;
    index: number;
    isLast: boolean;
  }>;

  // ── Internal state ──────────────────────────────────────────
  readonly expanded = signal(false);

  // ── Computed: current step (shown when collapsed) ──────────
  readonly current_step = computed<TimelineStep | null>(() => {
    const all = this.steps();
    // Find the active step: current or terminal first, then last completed
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].status === 'current' || all[i].status === 'terminal') return all[i];
    }
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].status === 'completed') return all[i];
    }
    return all.length > 0 ? all[0] : null;
  });

  // ── Computed: whether to show the full timeline ────────────
  readonly show_timeline = computed(() => {
    if (!this.collapsible()) return true;
    return this.expanded();
  });

  readonly show_toggle = computed(() => this.collapsible());

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  getMarkerClasses(step: TimelineStep): Record<string, boolean> {
    return {
      completed: step.status === 'completed',
      current: step.status === 'current',
      upcoming: step.status === 'upcoming',
      pending: step.status === 'pending',
      'terminal-danger': step.status === 'terminal' && step.variant === 'danger',
      'terminal-warning': step.status === 'terminal' && step.variant === 'warning',
    };
  }

  getLabelClasses(step: TimelineStep): Record<string, boolean> {
    return {
      'text-green-600': step.status === 'completed',
      'text-green-800': step.status === 'current',
      'text-gray-400': step.status === 'upcoming' || step.status === 'pending',
      'text-red-600': step.status === 'terminal' && step.variant === 'danger',
      'text-orange-600': step.status === 'terminal' && step.variant === 'warning',
    };
  }
}
