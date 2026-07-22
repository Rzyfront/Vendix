import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import {
  membershipProgress,
  MembershipProgress,
} from '../../utils/membership-progress.util';

/**
 * Presentational progress indicator for a membership period.
 *
 * Renders either a horizontal bar or an SVG donut showing elapsed vs total
 * days of the membership vigencia. Pure presentation: no services, no business
 * logic — all geometry derived with `computed()` from signal inputs.
 *
 * Anti-SSE-bug rule: transitions ONLY `width` (bar) or `stroke-dashoffset`
 * (donut). NEVER uses `transition: all` (a known repo bug that restarts
 * animations under continuous change detection).
 */
@Component({
  selector: 'app-membership-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './membership-progress.component.html',
  styleUrl: './membership-progress.component.css',
})
export class MembershipProgressComponent {
  // --- Inputs (Angular 20 signal API) ---
  readonly periodStart = input<string | null | undefined>(null);
  readonly periodEnd = input<string | null | undefined>(null);
  readonly variant = input<'bar' | 'donut'>('bar');
  readonly statusColor = input<string>('#16a34a');

  // --- Progress (derived from util) ---
  readonly progress = computed<MembershipProgress>(() =>
    membershipProgress(this.periodStart(), this.periodEnd()),
  );

  // --- Donut geometry (fixed radius; viewBox 0 0 120 120, center 60,60) ---
  readonly radius = 52;
  readonly circumference = 2 * Math.PI * this.radius;

  /** Dash offset that reveals the arc proportionally to elapsed percent. */
  readonly dashOffset = computed(
    () => this.circumference * (1 - this.progress().percent / 100),
  );
}