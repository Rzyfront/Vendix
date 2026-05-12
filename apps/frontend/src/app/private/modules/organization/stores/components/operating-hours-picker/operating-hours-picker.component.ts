import { Component, input, output, signal, model, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormControl } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/index';

export interface DaySchedule {
  open: string;
  close: string;
  is_closed: boolean;
  breaks?: { start: string; end: string }[];
}

export interface OperatingHoursValue {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

const DEFAULT_SCHEDULE: DaySchedule = {
  open: '09:00',
  close: '18:00',
  is_closed: false,
  breaks: [],
};

const DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
] as const;

const TIME_OPTIONS = (() => {
  const options: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hour = h.toString().padStart(2, '0');
      const min = m.toString().padStart(2, '0');
      const time = `${hour}:${min}`;
      const label = new Date(`2024-01-01T${time}:00`).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      options.push({ value: time, label });
    }
  }
  return options;
})();

@Component({
  selector: 'app-operating-hours-picker',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  template: `
    <div class="space-y-3">
      @for (day of days; track day.key) {
        <div
          class="flex items-center gap-4 p-3 rounded-lg border"
          [class.border-border]="!schedule()[day.key]?.is_closed"
          [class.bg-muted/30]="schedule()[day.key]?.is_closed"
        >
          <!-- Day Name -->
          <div class="w-28 shrink-0">
            <span class="text-sm font-medium text-text-primary">
              {{ day.label }}
            </span>
          </div>

          <!-- Closed Toggle -->
          <label class="flex items-center gap-2 shrink-0">
            <input
              type="checkbox"
              [checked]="schedule()[day.key]?.is_closed ?? false"
              (change)="toggleDay(day.key, $event)"
              class="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span class="text-xs text-text-secondary whitespace-nowrap">Cerrado</span>
          </label>

          <!-- Time Slots -->
          @if (!(schedule()[day.key]?.is_closed ?? false)) {
            <div class="flex items-center gap-2 flex-1 flex-wrap">
              <!-- Open Time -->
              <div class="flex items-center gap-1">
                <span class="text-xs text-text-secondary">Abre</span>
                <select
                  [value]="schedule()[day.key]?.open ?? '09:00'"
                  (change)="updateTime(day.key, 'open', $event)"
                  class="text-sm border border-border rounded px-2 py-1 bg-surface focus:ring-1 focus:ring-primary focus:border-primary"
                >
                  @for (opt of timeOptions; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }}</option>
                  }
                </select>
              </div>

              <!-- Close Time -->
              <div class="flex items-center gap-1">
                <span class="text-xs text-text-secondary">Cierra</span>
                <select
                  [value]="schedule()[day.key]?.close ?? '18:00'"
                  (change)="updateTime(day.key, 'close', $event)"
                  class="text-sm border border-border rounded px-2 py-1 bg-surface focus:ring-1 focus:ring-primary focus:border-primary"
                >
                  @for (opt of timeOptions; track opt.value) {
                    <option [value]="opt.value">{{ opt.label }}</option>
                  }
                </select>
              </div>

              <!-- Break Toggle -->
              @if (hasBreak(day.key)) {
                <button
                  type="button"
                  (click)="removeBreak(day.key)"
                  class="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1"
                >
                  <app-icon name="x" size="12" />
                  Quitar descanso
                </button>
              } @else {
                <button
                  type="button"
                  (click)="addBreak(day.key)"
                  class="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <app-icon name="plus" size="12" />
                  Agregar descanso
                </button>
              }

              <!-- Breaks -->
              @if (schedule()[day.key]?.breaks?.length) {
                @for (br of schedule()[day.key]?.breaks; track $index; let bi = $index) {
                  <div class="flex items-center gap-1 text-xs text-text-secondary">
                    <span>Descanso {{ bi + 1 }}:</span>
                    <select
                      [value]="br.start"
                      (change)="updateBreak(day.key, bi, 'start', $event)"
                      class="text-xs border border-border rounded px-1 py-0.5 bg-surface"
                    >
                      @for (opt of timeOptions; track opt.value) {
                        <option [value]="opt.value">{{ opt.label }}</option>
                      }
                    </select>
                    <span>-</span>
                    <select
                      [value]="br.end"
                      (change)="updateBreak(day.key, bi, 'end', $event)"
                      class="text-xs border border-border rounded px-1 py-0.5 bg-surface"
                    >
                      @for (opt of timeOptions; track opt.value) {
                        <option [value]="opt.value">{{ opt.label }}</option>
                      }
                    </select>
                    <button
                      type="button"
                      (click)="removeBreak(day.key, bi)"
                      class="text-text-secondary hover:text-destructive"
                    >
                      <app-icon name="x" size="10" />
                    </button>
                  </div>
                }
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class OperatingHoursPickerComponent implements OnInit {
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  readonly value = model<OperatingHoursValue | null>(null);
  readonly disabled = input(false);

  readonly days = DAYS;
  readonly timeOptions = TIME_OPTIONS;

  schedule = signal<Partial<Record<string, DaySchedule>>>({});

  ngOnInit(): void {
    if (this.value()) {
      this.schedule.set(this.value() as any);
    } else {
      // Initialize with defaults
      const defaultSchedule: Partial<Record<string, DaySchedule>> = {};
      for (const day of DAYS) {
        defaultSchedule[day.key] = { ...DEFAULT_SCHEDULE };
      }
      defaultSchedule['sunday'] = { open: '09:00', close: '14:00', is_closed: false, breaks: [] };
      defaultSchedule['saturday'] = { open: '09:00', close: '14:00', is_closed: false, breaks: [] };
      this.schedule.set(defaultSchedule);
      this.emitChange();
    }
  }

  toggleDay(key: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.schedule.update((s) => ({
      ...s,
      [key]: { ...DEFAULT_SCHEDULE, is_closed: checked },
    }));
    this.emitChange();
  }

  updateTime(key: string, field: 'open' | 'close', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.schedule.update((s) => ({
      ...s,
      [key]: { ...s[key]!, [field]: value },
    }));
    this.emitChange();
  }

  hasBreak(key: string): boolean {
    return !!(this.schedule()[key]?.breaks?.length);
  }

  addBreak(key: string): void {
    this.schedule.update((s) => ({
      ...s,
      [key]: {
        ...s[key]!,
        breaks: [...(s[key]?.breaks ?? []), { start: '12:00', end: '13:00' }],
      },
    }));
    this.emitChange();
  }

  removeBreak(key: string, index?: number): void {
    this.schedule.update((s) => {
      const day = s[key]!;
      if (index !== undefined) {
        return {
          ...s,
          [key]: {
            ...day,
            breaks: day.breaks?.filter((_, i) => i !== index),
          },
        };
      }
      return { ...s, [key]: { ...day, breaks: [] } };
    });
    this.emitChange();
  }

  updateBreak(key: string, breakIndex: number, field: 'start' | 'end', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.schedule.update((s) => ({
      ...s,
      [key]: {
        ...s[key]!,
        breaks: s[key]?.breaks?.map((br, i) =>
          i === breakIndex ? { ...br, [field]: value } : br,
        ) ?? [],
      },
    }));
    this.emitChange();
  }

  private emitChange(): void {
    // Clean up: remove breaks from closed days and serialize
    const result: OperatingHoursValue = {} as OperatingHoursValue;
    for (const day of DAYS) {
      const dayData = this.schedule()[day.key];
      if (dayData) {
        (result as any)[day.key] = dayData.is_closed
          ? { open: null, close: null, is_closed: true, breaks: [] }
          : dayData;
      }
    }
    this.value.set(result);
  }
}
