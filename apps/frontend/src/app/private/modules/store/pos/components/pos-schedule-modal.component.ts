import { Component, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
} from '../../../../../shared/components';

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
    >
      <div slot="header" class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"
        >
          <app-icon name="clock" [size]="20" class="text-primary"></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">
            Horario de Atención
          </h2>
          <p class="text-sm text-text-secondary">
            {{ isWithinHours() ? 'Activo ahora' : 'Fuera de horario' }}
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <div
          class="flex items-center gap-2 p-3 rounded-xl"
          [ngClass]="
            isWithinHours()
              ? 'bg-green-50 border border-green-200'
              : 'bg-amber-50 border border-amber-200'
          "
        >
          <span
            class="h-2.5 w-2.5 rounded-full flex-shrink-0"
            [ngClass]="isWithinHours() ? 'bg-green-500' : 'bg-amber-400'"
          ></span>
          <span
            class="text-sm font-medium"
            [ngClass]="isWithinHours() ? 'text-green-700' : 'text-amber-700'"
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
            class="flex items-center justify-between py-2.5 px-3 rounded-lg"
            [ngClass]="{
              'bg-primary/5 border border-primary/20': day.key === todayKey(),
              'hover:bg-surface/50': day.key !== todayKey(),
            }"
          >
            <div class="flex items-center gap-2">
              @if (day.key === todayKey()) {
                <span
                  class="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0"
                ></span>
              }
              <span
                class="text-sm"
                [ngClass]="
                  day.key === todayKey()
                    ? 'font-semibold text-text-primary'
                    : 'text-text-secondary'
                "
              >
                {{ day.label }}
              </span>
              @if (day.key === todayKey()) {
                <span
                  class="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-md uppercase tracking-wider"
                  >Hoy</span
                >
              }
            </div>
            <span
              class="text-sm"
              [ngClass]="
                isDayClosed(day.key)
                  ? 'text-red-400 font-medium'
                  : 'text-text-primary font-medium'
              "
            >
              {{ isDayClosed(day.key) ? 'Cerrado' : getDayHours(day.key) }}
            </span>
          </div>
        }
      </div>

      <div slot="footer">
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
          <app-button variant="outline" size="sm" (clicked)="onClose()"
            >Cerrar</app-button
          >
          <app-button variant="primary" size="sm" (clicked)="onGoToSettings()">
            <app-icon name="settings" [size]="16" slot="icon"></app-icon>
            Configurar Horarios
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PosScheduleModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly businessHours = input<Record<string, { open: string; close: string }>>({});
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
    return !hours || !hours.open || !hours.close;
  }

  getDayHours(key: string): string {
    const hours = this.businessHours()[key];
    if (!hours) return 'Cerrado';
    return `${hours.open} – ${hours.close}`;
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  onGoToSettings(): void {
    this.goToSettings.emit();
  }
}
