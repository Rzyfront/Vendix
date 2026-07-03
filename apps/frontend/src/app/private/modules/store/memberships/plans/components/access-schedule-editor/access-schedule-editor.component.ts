import { Component, computed, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';
import { AccessScheduleWindow } from '../../interfaces';

interface DayOption {
  value: number;
  label: string;
}

interface IndexedWindow {
  index: number;
  window: AccessScheduleWindow;
  invalid: boolean;
}

interface DayGroup extends DayOption {
  entries: IndexedWindow[];
}

/**
 * Optional per-plan access-schedule (opening-hours) editor.
 *
 * ControlValueAccessor that round-trips an `AccessScheduleWindow[]`. Each window
 * is `{ day_of_week: 0..6 (0=Sunday), start_time: "HH:mm", end_time: "HH:mm" }`,
 * matching the backend contract. An empty array means "no restriction" (access
 * at any hour); when at least one window exists, days without windows have no
 * access. Zoneless: all template-observed state lives in signals.
 */
@Component({
  selector: 'app-access-schedule-editor',
  standalone: true,
  imports: [IconComponent, ButtonComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AccessScheduleEditorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="space-y-3">
      @if (isEmpty()) {
        <div
          class="flex items-center gap-2 rounded-lg border border-dashed border-border bg-background px-3 py-2.5 text-sm text-text-muted"
        >
          <app-icon name="clock" [size]="16" />
          <span>Sin horario: acceso a toda hora.</span>
        </div>
      }

      <div class="space-y-2">
        @for (day of groupedWindows(); track day.value) {
          <div
            class="rounded-lg border border-border bg-[var(--color-surface)] p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-text-primary">{{
                day.label
              }}</span>
              <app-button
                type="button"
                variant="ghost"
                size="xsm"
                [disabled]="isDisabled()"
                (clicked)="addWindow(day.value)"
              >
                <app-icon slot="icon" name="plus" [size]="14" />
                Agregar franja
              </app-button>
            </div>

            @if (day.entries.length > 0) {
              <div class="mt-2 space-y-2">
                @for (entry of day.entries; track entry.index) {
                  <div class="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      [value]="entry.window.start_time"
                      [disabled]="isDisabled()"
                      (change)="updateStart(entry.index, $event)"
                      aria-label="Hora de inicio"
                      class="px-2.5 py-1.5 rounded-lg border bg-background text-sm text-text-primary outline-none focus:border-primary disabled:opacity-40"
                      [class.border-border]="!entry.invalid"
                      [class.border-destructive]="entry.invalid"
                    />
                    <span class="text-xs text-text-muted">a</span>
                    <input
                      type="time"
                      [value]="entry.window.end_time"
                      [disabled]="isDisabled()"
                      (change)="updateEnd(entry.index, $event)"
                      aria-label="Hora de fin"
                      class="px-2.5 py-1.5 rounded-lg border bg-background text-sm text-text-primary outline-none focus:border-primary disabled:opacity-40"
                      [class.border-border]="!entry.invalid"
                      [class.border-destructive]="entry.invalid"
                    />
                    <button
                      type="button"
                      [disabled]="isDisabled()"
                      (click)="removeWindow(entry.index)"
                      aria-label="Eliminar franja"
                      class="p-1.5 rounded-lg text-text-muted transition-colors hover:bg-background hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <app-icon name="trash" [size]="16" />
                    </button>
                  </div>
                  @if (entry.invalid) {
                    <p class="text-xs text-destructive">
                      La hora de inicio debe ser menor que la de fin.
                    </p>
                  }
                }
              </div>
            } @else {
              @if (isEmpty()) {
                <p class="mt-1 text-xs text-text-muted">Acceso a toda hora.</p>
              } @else {
                <p class="mt-1 text-xs text-warning">
                  Cerrado — sin acceso este día.
                </p>
              }
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class AccessScheduleEditorComponent implements ControlValueAccessor {
  private readonly windows = signal<AccessScheduleWindow[]>([]);
  private readonly disabledFromForm = signal(false);

  /** Days rendered Mon→Sun for UX; the numeric `value` still matches 0=Sunday. */
  readonly days: DayOption[] = [
    { value: 1, label: 'Lunes' },
    { value: 2, label: 'Martes' },
    { value: 3, label: 'Miércoles' },
    { value: 4, label: 'Jueves' },
    { value: 5, label: 'Viernes' },
    { value: 6, label: 'Sábado' },
    { value: 0, label: 'Domingo' },
  ];

  readonly isDisabled = computed(() => this.disabledFromForm());
  readonly isEmpty = computed(() => this.windows().length === 0);

  readonly groupedWindows = computed<DayGroup[]>(() => {
    const all = this.windows();
    return this.days.map((day) => ({
      ...day,
      entries: all
        .map((window, index) => ({ window, index }))
        .filter((e) => e.window.day_of_week === day.value)
        .map(({ window, index }) => ({
          window,
          index,
          invalid: this.isInvalidWindow(window),
        })),
    }));
  });

  private onChange: (value: AccessScheduleWindow[]) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: AccessScheduleWindow[] | null | undefined): void {
    this.windows.set(this.normalize(value));
  }

  registerOnChange(fn: (value: AccessScheduleWindow[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledFromForm.set(isDisabled);
  }

  addWindow(day: number): void {
    if (this.isDisabled()) return;
    this.windows.update((list) => [
      ...list,
      { day_of_week: day, start_time: '08:00', end_time: '20:00' },
    ]);
    this.emit();
  }

  removeWindow(index: number): void {
    if (this.isDisabled()) return;
    this.windows.update((list) => list.filter((_, i) => i !== index));
    this.emit();
  }

  updateStart(index: number, event: Event): void {
    this.patchWindow(index, {
      start_time: (event.target as HTMLInputElement).value,
    });
  }

  updateEnd(index: number, event: Event): void {
    this.patchWindow(index, {
      end_time: (event.target as HTMLInputElement).value,
    });
  }

  isInvalidWindow(window: AccessScheduleWindow): boolean {
    if (!window.start_time || !window.end_time) return false;
    // "HH:mm" strings compare lexicographically for 24h zero-padded times.
    return window.start_time >= window.end_time;
  }

  private patchWindow(
    index: number,
    patch: Partial<AccessScheduleWindow>,
  ): void {
    if (this.isDisabled()) return;
    this.windows.update((list) =>
      list.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );
    this.emit();
  }

  private emit(): void {
    this.onChange(this.windows());
    this.onTouched();
  }

  private normalize(
    value: AccessScheduleWindow[] | null | undefined,
  ): AccessScheduleWindow[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((w) => w && typeof w.day_of_week === 'number')
      .map((w) => ({
        day_of_week: Number(w.day_of_week),
        start_time: this.toHHmm(w.start_time),
        end_time: this.toHHmm(w.end_time),
      }));
  }

  /** Trim any legacy "HH:mm:ss" down to the "HH:mm" the backend expects. */
  private toHHmm(time: unknown): string {
    return typeof time === 'string' ? time.slice(0, 5) : '';
  }
}
