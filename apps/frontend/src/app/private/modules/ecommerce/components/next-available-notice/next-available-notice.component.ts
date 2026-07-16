import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  NextAvailableDetailed,
} from '../../services/next-available.util';

/**
 * Inline block that appears beneath a disabled "Agregar" / "Comprar ahora"
 * button when a menu (carta) dish is off-schedule. Surfaces when the dish
 * becomes available again + a coarse countdown ("en 5d 9h", "mañana",
 * "hoy a las 19:30") so the customer understands *why* the action is
 * disabled and *when* it will return.
 *
 * Renders nothing when `next()` is null/undefined or empty label.
 */
@Component({
  selector: 'app-next-available-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (next(); as n) {
      @if (n.label) {
        <div
          class="next-available-notice"
          role="status"
          aria-live="polite"
        >
          <span class="next-available-notice__icon" aria-hidden="true">
            <app-icon name="clock" [size]="14"></app-icon>
          </span>
          <span class="next-available-notice__text">
            Vuelve el <strong>{{ n.label }}</strong>
            <span class="next-available-notice__delta"> ({{ n.delta }})</span>
          </span>
        </div>
      }
    }
  `,
  styleUrls: ['./next-available-notice.component.scss'],
})
export class NextAvailableNoticeComponent {
  /** Result from `formatNextAvailableDetailed` / `nextAvailableFor`. */
  readonly next = input<NextAvailableDetailed | null>(null);
}
