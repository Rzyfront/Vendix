import { Component, computed, input, model, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ToggleComponent } from '../toggle/toggle.component';
import { ButtonComponent } from '../button/button.component';
import { ClockWindow } from '../../utils/schedule-window.util';
import {
  COPY_TARGETS,
  CopyTarget,
  DaySegment,
  MAX_BLOCKS_PER_DAY,
  WEEK_DAYS,
  WEEK_PRESETS,
  WeekHoursDay,
  WeekPreset,
  applyPreset,
  blockKey,
  copyDay,
  dayLabel,
  daySegments,
  dayText,
  endsNextDay,
  formatTime12,
  nextBlock,
  normalizeWeek,
  openDaysCount,
  summarizeWeek,
  timeOptions,
  validateWeek,
  weeklyHours,
} from './weekly-hours.util';

interface DayRow {
  day: WeekHoursDay;
  label: string;
  short: string;
  text: string;
  segments: DaySegment[];
  dayIssue: string | null;
}

const DEFAULT_OPTIONS = timeOptions();

/**
 * The ONE weekly schedule editor: Agenda → Horario de la tienda, Ajustes →
 * Venta and a provider's own schedule (also read-only, for a provider that
 * works the store hours). Presentational: the parent loads and saves.
 *
 * - `days` is two-way (`[(days)]`); every edit writes a new week.
 * - Inline problems next to the block, plain summary on top, a 0–24 h bar per
 *   day (night shifts spill into the next day's bar).
 * - `showSave` adds the footer with the save button (`save` emits the week
 *   only when it has no problems).
 */
@Component({
  selector: 'app-weekly-hours-editor',
  standalone: true,
  imports: [IconComponent, ToggleComponent, ButtonComponent],
  templateUrl: './weekly-hours-editor.component.html',
  styleUrls: ['./weekly-hours-editor.component.scss'],
})
export class WeeklyHoursEditorComponent {
  readonly days = model.required<WeekHoursDay[]>();
  readonly readOnly = input(false);
  /** Shortcuts row (24/7, weekdays, night shift). */
  readonly showPresets = input(true);
  /** Store schedule: at least one day must be open. */
  readonly requireOpenDay = input(false);
  readonly showSave = input(false);
  readonly saving = input(false);
  /** There are changes to save (the parent compares against the saved week). */
  readonly dirty = input(true);
  /** The last save succeeded and nothing changed since. */
  readonly saved = input(false);
  readonly saveLabel = input('Guardar horario');
  readonly save = output<WeekHoursDay[]>();

  readonly maxBlocks = MAX_BLOCKS_PER_DAY;
  readonly presets = WEEK_PRESETS;
  readonly copyTargets = COPY_TARGETS;
  readonly hourTicks = [
    { pct: 0, label: '12 a. m.' },
    { pct: 25, label: '6 a. m.' },
    { pct: 50, label: '12 p. m.' },
    { pct: 75, label: '6 p. m.' },
    { pct: 100, label: '12 a. m.' },
  ];

  readonly week = computed(() => normalizeWeek(this.days() ?? []));
  readonly summary = computed(() => summarizeWeek(this.week()));
  readonly openDays = computed(() => openDaysCount(this.week()));
  readonly hours = computed(() => weeklyHours(this.week()));
  readonly issues = computed(() =>
    validateWeek(this.week(), { requireOpenDay: this.requireOpenDay() }),
  );
  readonly rows = computed<DayRow[]>(() => {
    const week = this.week();
    const issues = this.issues();
    return WEEK_DAYS.map((w) => {
      const day = week.find((d) => d.day_of_week === w.dow)!;
      return {
        day,
        label: w.label,
        short: w.short,
        text: dayText(day, false),
        segments: daySegments(week, w.dow),
        dayIssue: issues.days[w.dow] ?? null,
      };
    });
  });
  readonly canSave = computed(
    () => !this.readOnly() && !this.saving() && this.dirty() && this.issues().count === 0,
  );

  /** Day whose «Copiar a…» choices are open. */
  readonly copyMenuFor = signal<number | null>(null);

  readonly endsNextDay = endsNextDay;
  readonly formatTime12 = formatTime12;

  blockIssue(dow: number, index: number): string | null {
    return this.issues().blocks[blockKey(dow, index)] ?? null;
  }

  optionsFor(value: string): Array<{ value: string; label: string }> {
    return DEFAULT_OPTIONS.some((o) => o.value === value) ? DEFAULT_OPTIONS : timeOptions(value);
  }

  private update(dow: number, change: (d: WeekHoursDay) => WeekHoursDay): void {
    if (this.readOnly()) return;
    this.days.set(this.week().map((d) => (d.day_of_week === dow ? change(d) : d)));
  }

  toggleOpen(dow: number): void {
    this.update(dow, (d) => ({ ...d, is_active: !d.is_active }));
    if (this.copyMenuFor() === dow) this.copyMenuFor.set(null);
  }

  toggle24h(dow: number): void {
    this.update(dow, (d) => ({ ...d, is_active: true, is_24h: !d.is_24h }));
  }

  setTime(dow: number, index: number, field: keyof ClockWindow, value: string): void {
    this.update(dow, (d) => ({
      ...d,
      blocks: d.blocks.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    }));
  }

  addBlock(dow: number): void {
    this.update(dow, (d) =>
      d.blocks.length >= MAX_BLOCKS_PER_DAY ? d : { ...d, blocks: [...d.blocks, nextBlock(d)] },
    );
  }

  removeBlock(dow: number, index: number): void {
    this.update(dow, (d) =>
      d.blocks.length <= 1 ? d : { ...d, blocks: d.blocks.filter((_, i) => i !== index) },
    );
  }

  applyPreset(preset: WeekPreset): void {
    if (this.readOnly()) return;
    this.days.set(applyPreset(this.week(), preset));
    this.copyMenuFor.set(null);
  }

  toggleCopyMenu(dow: number): void {
    this.copyMenuFor.set(this.copyMenuFor() === dow ? null : dow);
  }

  copyTo(dow: number, target: CopyTarget): void {
    if (this.readOnly()) return;
    this.days.set(copyDay(this.week(), dow, target));
    this.copyMenuFor.set(null);
  }

  copyMenuLabel(dow: number): string {
    return `Copiar el horario del ${dayLabel(dow).toLowerCase()} a…`;
  }

  onSave(): void {
    if (!this.canSave()) return;
    this.save.emit(this.week());
  }
}
