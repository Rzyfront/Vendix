import { Component, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
} from '../../../../../shared/components';
import type { BusinessHours } from '../../../../../core/models/store-settings.interface';

@Component({
  selector: 'app-pos-schedule-modal',
  standalone: true,
  imports: [NgClass, ButtonComponent, ModalComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      size="sm"
      [showCloseButton]="true"
      [dialog]="true"
      title="Horario de atención"
    >
      <div slot="header" class="flex items-center justify-center">
        <div
          class="w-10 h-10 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center"
        >
          <app-icon name="clock" [size]="20" color="var(--color-primary)"></app-icon>
        </div>
      </div>

      <div class="space-y-3">
        <div
          class="flex items-center gap-2 p-3 rounded-xl border"
          role="status"
          [ngClass]="
            isWithinHours()
              ? 'bg-[var(--color-success-50)] border-[var(--color-success-200)]'
              : 'bg-[var(--color-warning-50)] border-[var(--color-warning-200)]'
          "
        >
          <span
            class="h-2.5 w-2.5 rounded-full flex-shrink-0"
            aria-hidden="true"
            [ngClass]="isWithinHours() ? 'bg-[var(--color-success-500)]' : 'bg-[var(--color-warning-500)]'"
          ></span>
          <span
            class="text-sm font-medium"
            [ngClass]="isWithinHours() ? 'text-[var(--color-success-800)]' : 'text-[var(--color-warning-800)]'"
          >
            {{
              isWithinHours()
                ? 'Dentro del horario de atención'
                : 'Fuera del horario de atención'
            }}
          </span>
        </div>

        @for (day of daysOfWeek; track day.key) {
          <div
            class="flex items-center justify-between py-2.5 px-3 rounded-lg min-h-[44px]"
            [ngClass]="{
              'bg-[var(--color-primary-light)] border border-[var(--color-primary)]': day.key === todayKey(),
              'border border-transparent': day.key !== todayKey(),
            }"
          >
            <div class="flex items-center gap-2">
              @if (day.key === todayKey()) {
                <span
                  class="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] flex-shrink-0"
                  aria-hidden="true"
                ></span>
              }
              <span
                class="text-sm"
                [ngClass]="
                  day.key === todayKey()
                    ? 'font-semibold text-[var(--color-text-primary)]'
                    : 'text-[var(--color-neutral-600)]'
                "
              >
                {{ day.label }}
              </span>
              @if (day.key === todayKey()) {
                <span
                  class="text-[10px] font-bold text-[var(--color-text-on-primary)] bg-[var(--color-success-700)] px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                  >Hoy</span
                >
              }
            </div>
            <span
              class="text-sm font-medium tabular-nums"
              [ngClass]="
                isDayClosed(day.key)
                  ? 'text-[var(--color-error-600)]'
                  : 'text-[var(--color-text-primary)]'
              "
            >
              {{ isDayClosed(day.key) ? 'Cerrado' : getDayHours(day.key) }}
            </span>
          </div>
        }
      </div>

      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-[var(--color-border)]"
        >
          <app-button variant="outline" size="md" (clicked)="onClose()"
            >Cerrar</app-button
          >
          <app-button variant="primary" size="md" (clicked)="onGoToSettings()">
            <app-icon name="settings" [size]="16" slot="icon" ></app-icon>
            Configurar horarios
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PosScheduleModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly businessHours = input<Record<string, BusinessHours>>({});
  readonly isWithinHours = input<boolean>(false);
  readonly todayKey = input<string>('');

  readonly isOpenChange = output<boolean>();
  readonly goToSettings = output<void>();

  daysOfWeek = [
    { key: 'monday', label: 'Lunes', short: 'Lun' },
    { key: 'tuesday', label: 'Martes', short: 'Mar' },
    { key: 'wednesday', label: 'Miércoles', short: 'Mié' },
    { key: 'thursday', label: 'Jueves', short: 'Jue' },
    { key: 'friday', label: 'Viernes', short: 'Vie' },
    { key: 'saturday', label: 'Sábado', short: 'Sáb' },
    { key: 'sunday', label: 'Domingo', short: 'Dom' },
  ];

  isDayClosed(key: string): boolean {
    const hours = this.businessHours()[key];
    if (!hours) return true;
    if (hours.blocks && hours.blocks.length > 0) {
      return hours.blocks.every(b => b.open === 'closed' || b.close === 'closed');
    }
    return !hours.open || !hours.close || hours.open === 'closed' || hours.close === 'closed';
  }

  getDayHours(key: string): string {
    const hours = this.businessHours()[key];
    if (!hours) return 'Cerrado';
    if (hours.blocks && hours.blocks.length > 0) {
      return hours.blocks
        .filter(b => b.open !== 'closed' && b.close !== 'closed')
        .map(b => `${b.open} – ${b.close}`)
        .join(', ');
    }
    return `${hours.open} – ${hours.close}`;
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  onGoToSettings(): void {
    this.goToSettings.emit();
  }
}
