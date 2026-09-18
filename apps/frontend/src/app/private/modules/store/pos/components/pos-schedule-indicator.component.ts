
import { Component, input, output } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { BusinessHours } from '../../../../../core/models/store-settings.interface';

@Component({
  selector: 'app-pos-schedule-indicator',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (enabled()) {
      @if (isWithinHours() && !isDayClosed()) {
        <div
          role="status"
          class="flex items-center gap-2 px-3 py-2 bg-[var(--color-success-50)] border border-[var(--color-success-200)] rounded-xl text-[var(--color-success-800)] min-h-[44px]"
        >
          <!-- Pulsing green indicator -->
          <span
            class="relative flex h-2.5 w-2.5 flex-shrink-0"
            aria-hidden="true"
          >
            <span
              class="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success-400)] opacity-75"
            ></span>
            <span
              class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--color-success-500)]"
            ></span>
          </span>

          <!-- Status label -->
          <span class="font-semibold text-sm truncate">En servicio</span>

          <!-- Separator -->
          <span class="text-[var(--color-success-300)] hidden sm:inline" aria-hidden="true"
            >&middot;</span
          >

          <!-- Hours range -->
          <span
            class="text-[var(--color-success-800)] text-xs hidden sm:inline whitespace-nowrap tabular-nums"
            >{{ hoursText() }}</span
          >

          <!-- Action button -->
          <button
            type="button"
            (click)="clicked.emit()"
            class="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-[var(--color-success-100)] text-[var(--color-success-800)] hover:bg-[var(--color-success-200)] active:scale-95 transition-all ml-auto flex-shrink-0 cursor-pointer focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)]"
            aria-label="Ver horario de atención"
            title="Ver horario"
          >
            <app-icon name="clock" [size]="18"></app-icon>
          </button>
        </div>
      } @else {
        <div
          role="status"
          class="flex items-center gap-2 px-3 py-2 bg-[var(--color-error-50)] border border-[var(--color-error-200)] rounded-xl text-[var(--color-error-700)] min-h-[44px]"
        >
          <!-- Static red indicator -->
          <span
            class="relative flex h-2.5 w-2.5 flex-shrink-0"
            aria-hidden="true"
          >
            <span
              class="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--color-error-500)]"
            ></span>
          </span>

          <!-- Status label -->
          <span class="font-semibold text-sm truncate">
            @if (isDayClosed()) {
              Cerrado hoy
            } @else {
              Fuera de servicio
            }
          </span>

          <!-- Separator + hours -->
          @if (!isDayClosed() && todayHours()) {
            <span class="text-[var(--color-error-300)] hidden sm:inline" aria-hidden="true"
              >&middot;</span
            >
            <span
              class="text-[var(--color-error-700)] text-xs hidden sm:inline whitespace-nowrap tabular-nums"
              >{{ hoursText() }}</span
            >
          }

          <!-- Action button -->
          <button
            type="button"
            (click)="clicked.emit()"
            class="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-[var(--color-error-100)] text-[var(--color-error-700)] hover:bg-[var(--color-error-200)] active:scale-95 transition-all ml-auto flex-shrink-0 cursor-pointer focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-primary)]"
            aria-label="Ver horario de atención"
            title="Ver horario"
          >
            <app-icon name="clock" [size]="18"></app-icon>
          </button>
        </div>
      }
    }
  `,
})
export class PosScheduleIndicatorComponent {
  readonly isWithinHours = input<boolean>(false);
  readonly todayHours = input<BusinessHours | null>(null);
  readonly isDayClosed = input<boolean>(false);
  readonly enabled = input<boolean>(false);

  readonly clicked = output<void>();

  hoursText(): string {
    const hours = this.todayHours();
    if (!hours) return '';
    if (hours.blocks && hours.blocks.length > 0) {
      return hours.blocks
        .filter(b => b.open !== 'closed' && b.close !== 'closed')
        .map(b => `${b.open} – ${b.close}`)
        .join(', ');
    }
    return `${hours.open} – ${hours.close}`;
  }
}
