
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-pos-schedule-indicator',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (enabled) {
      @if (isWithinHours && !isDayClosed) {
        <div
          class="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-green-700 min-h-[40px]"
        >
          <!-- Pulsing green indicator -->
          <span
            class="relative flex h-2.5 w-2.5 flex-shrink-0"
            aria-hidden="true"
          >
            <span
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
            ></span>
            <span
              class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"
            ></span>
          </span>

          <!-- Status label -->
          <span class="font-semibold text-sm truncate">En servicio</span>

          <!-- Separator -->
          <span class="text-green-300 hidden sm:inline" aria-hidden="true"
            >&middot;</span
          >

          <!-- Hours range -->
          <span
            class="text-green-600/80 text-xs hidden sm:inline whitespace-nowrap"
            >{{ hoursText() }}</span
          >

          <!-- Action button — same min-h as status bar buttons -->
          <button
            type="button"
            (click)="clicked.emit()"
            class="flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg bg-green-100/80 text-green-700 hover:bg-green-200 active:scale-95 transition-all ml-auto flex-shrink-0 cursor-pointer"
            aria-label="Ver horario de atención"
            title="Ver horario"
          >
            <app-icon name="clock" [size]="16"></app-icon>
          </button>
        </div>
      } @else {
        <div
          class="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-600 min-h-[40px]"
        >
          <!-- Static red indicator -->
          <span
            class="relative flex h-2.5 w-2.5 flex-shrink-0"
            aria-hidden="true"
          >
            <span
              class="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"
            ></span>
          </span>

          <!-- Status label -->
          <span class="font-semibold text-sm truncate">
            @if (isDayClosed) {
              Cerrado hoy
            } @else {
              Fuera de servicio
            }
          </span>

          <!-- Separator + hours -->
          @if (!isDayClosed && todayHours) {
            <span class="text-red-300 hidden sm:inline" aria-hidden="true"
              >&middot;</span
            >
            <span
              class="text-red-500/70 text-xs hidden sm:inline whitespace-nowrap"
              >{{ hoursText() }}</span
            >
          }

          <!-- Action button — same min-h as status bar buttons -->
          <button
            type="button"
            (click)="clicked.emit()"
            class="flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg bg-red-100/80 text-red-600 hover:bg-red-200 active:scale-95 transition-all ml-auto flex-shrink-0 cursor-pointer"
            aria-label="Ver horario de atención"
            title="Ver horario"
          >
            <app-icon name="clock" [size]="16"></app-icon>
          </button>
        </div>
      }
    }
  `,
})
export class PosScheduleIndicatorComponent {
  @Input() isWithinHours: boolean = false;
  @Input() todayHours: { open: string; close: string } | null = null;
  @Input() isDayClosed: boolean = false;
  @Input() enabled: boolean = false;

  @Output() clicked = new EventEmitter<void>();

  hoursText(): string {
    if (!this.todayHours) return '';
    return `${this.todayHours.open} – ${this.todayHours.close}`;
  }
}
