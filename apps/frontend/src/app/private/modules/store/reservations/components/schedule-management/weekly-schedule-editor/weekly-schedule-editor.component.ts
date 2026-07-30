import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ReservationsService } from '../../../services/reservations.service';
import { ProviderSchedule } from '../../../interfaces/reservation.interface';
import {
  IconComponent,
  SpinnerComponent,
  ToastService,
  ButtonComponent,
  ToggleComponent,
} from '../../../../../../../shared/components';

interface ScheduleBlock {
  block_order: number;
  start_time: string;
  end_time: string;
}

interface ScheduleDay {
  day_of_week: number;
  label: string;
  shortLabel: string;
  is_active: boolean;
  blocks: ScheduleBlock[];
  editingBlock: number | null; // index of block being edited, null = not editing
}

@Component({
  selector: 'app-weekly-schedule-editor',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent, ButtonComponent, ToggleComponent],
  templateUrl: './weekly-schedule-editor.component.html',
  styleUrls: ['./weekly-schedule-editor.component.scss'],
})
export class WeeklyScheduleEditorComponent {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly providerId = input.required<number>();
  readonly scheduleChanged = output<{ activeDays: number; weeklyHours: number }>();

  days = signal<ScheduleDay[]>([]);
  loading = signal(false);
  saving = signal(false);

  // Timeline range: 6:00 AM to 10:00 PM (16 hours)
  readonly RANGE_START = 6; // 6 AM
  readonly RANGE_END = 22; // 10 PM
  readonly RANGE_HOURS = 16;

  // Hour markers for the timeline header
  readonly hourMarkers = Array.from({ length: 9 }, (_, i) => this.RANGE_START + i * 2); // [6, 8, 10, 12, 14, 16, 18, 20, 22]

  constructor() {
    effect(() => {
      const id = this.providerId();
      if (id) {
        untracked(() => this.loadSchedule(id));
      }
    });
  }

  private loadSchedule(providerId: number): void {
    this.loading.set(true);
    this.reservationsService
      .getProviderSchedule(providerId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (schedules) => this.initDays(schedules),
        error: () => {
          this.initDays([]);
          this.toastService.error('Error al cargar horario');
        },
      });
  }

  private initDays(schedules: ProviderSchedule[]): void {
    const dayNames = [
      { day: 1, label: 'Lunes', short: 'Lun' },
      { day: 2, label: 'Martes', short: 'Mar' },
      { day: 3, label: 'Miércoles', short: 'Mié' },
      { day: 4, label: 'Jueves', short: 'Jue' },
      { day: 5, label: 'Viernes', short: 'Vie' },
      { day: 6, label: 'Sábado', short: 'Sáb' },
      { day: 0, label: 'Domingo', short: 'Dom' },
    ];

    // Group schedules by day_of_week, support multiple blocks per day
    const blocksByDay = new Map<number, ScheduleBlock[]>();
    for (const s of schedules) {
      if (!blocksByDay.has(s.day_of_week)) {
        blocksByDay.set(s.day_of_week, []);
      }
      blocksByDay.get(s.day_of_week)!.push({
        block_order: (s as any).block_order ?? 0,
        start_time: s.start_time,
        end_time: s.end_time,
      });
    }

    this.days.set(
      dayNames.map((dn) => {
        const blocks = blocksByDay.get(dn.day) || [];
        const hasBlocks = blocks.length > 0;
        return {
          day_of_week: dn.day,
          label: dn.label,
          shortLabel: dn.short,
          is_active: hasBlocks ? blocks.some(b => b.start_time && b.end_time) : false,
          blocks: hasBlocks ? blocks : [{ block_order: 0, start_time: '09:00', end_time: '18:00' }],
          editingBlock: null,
        };
      }),
    );
    this.emitStats();
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  formatTimeShort(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}${ampm}` : `${hour}:${m.toString().padStart(2, '0')}${ampm}`;
  }

  formatHourMarker(hour: number): string {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}${ampm}`;
  }

  private emitStats(): void {
    const days = this.days();
    const active = days.filter(d => d.is_active);
    let totalMin = 0;
    for (const d of active) {
      for (const block of d.blocks) {
        const [sh, sm] = block.start_time.split(':').map(Number);
        const [eh, em] = block.end_time.split(':').map(Number);
        totalMin += (eh * 60 + em) - (sh * 60 + sm);
      }
    }
    this.scheduleChanged.emit({ activeDays: active.length, weeklyHours: Math.round(totalMin / 60) });
  }

  toggleDay(index: number): void {
    const updated = [...this.days()];
    const day = { ...updated[index] };
    day.is_active = !day.is_active;

    // When activating, ensure 2 default blocks (morning + afternoon)
    // Replace single default block with split blocks
    if (day.is_active) {
      const hasRealSchedule = day.blocks.length > 1 || 
        (day.blocks.length === 1 && day.blocks[0].start_time !== '09:00');
      if (!hasRealSchedule) {
        day.blocks = [
          { block_order: 0, start_time: '08:00', end_time: '12:00' },
          { block_order: 1, start_time: '14:00', end_time: '18:00' },
        ];
      }
    }

    updated[index] = day;
    this.days.set(updated);
    this.emitStats();
  }

  startEditing(dayIndex: number, blockIndex: number): void {
    const updated = [...this.days()];
    updated[dayIndex] = { ...updated[dayIndex], editingBlock: blockIndex };
    this.days.set(updated);
  }

  stopEditing(dayIndex: number): void {
    const updated = [...this.days()];
    updated[dayIndex] = { ...updated[dayIndex], editingBlock: null };
    this.days.set(updated);
  }

  updateTime(dayIndex: number, blockIndex: number, field: 'start_time' | 'end_time', value: string): void {
    const updated = [...this.days()];
    const day = { ...updated[dayIndex] };
    const blocks = [...day.blocks];
    blocks[blockIndex] = { ...blocks[blockIndex], [field]: value };
    day.blocks = blocks;
    updated[dayIndex] = day;
    this.days.set(updated);
    this.emitStats();
  }

  addBlock(dayIndex: number): void {
    const updated = [...this.days()];
    const day = { ...updated[dayIndex] };
    const lastBlock = day.blocks[day.blocks.length - 1];
    // New block starts 1 hour after the last block ends
    const lastEndMinutes = this.timeToMinutes(lastBlock.end_time);
    const newStartMinutes = Math.min(lastEndMinutes + 60, this.RANGE_END * 60 - 60);
    const newEndMinutes = Math.min(newStartMinutes + 60, this.RANGE_END * 60);

    day.blocks = [
      ...day.blocks,
      {
        block_order: day.blocks.length,
        start_time: this.minutesToTime(newStartMinutes),
        end_time: this.minutesToTime(newEndMinutes),
      },
    ];
    updated[dayIndex] = day;
    this.days.set(updated);
    this.emitStats();
  }

  removeBlock(dayIndex: number, blockIndex: number): void {
    const updated = [...this.days()];
    const day = { ...updated[dayIndex] };
    if (day.blocks.length <= 1) return; // Don't remove the last block
    day.blocks = day.blocks.filter((_, i) => i !== blockIndex);
    // Re-order block_order
    day.blocks = day.blocks.map((b, i) => ({ ...b, block_order: i }));
    updated[dayIndex] = day;
    this.days.set(updated);
    this.emitStats();
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  // Quick actions
  applyPreset(preset: 'weekdays-9-6' | 'weekdays-8-5' | 'weekdays-split' | 'all-week'): void {
    const singleBlock = (start: string, end: string): ScheduleBlock[] => [
      { block_order: 0, start_time: start, end_time: end },
    ];
    const splitBlocks = (): ScheduleBlock[] => [
      { block_order: 0, start_time: '08:00', end_time: '12:00' },
      { block_order: 1, start_time: '14:00', end_time: '18:00' },
    ];

    const updated = this.days().map((d) => {
      if (preset === 'weekdays-9-6') {
        const isWeekday = d.day_of_week >= 1 && d.day_of_week <= 5;
        return { ...d, is_active: isWeekday, blocks: singleBlock('09:00', '18:00'), editingBlock: null };
      }
      if (preset === 'weekdays-8-5') {
        const isWeekday = d.day_of_week >= 1 && d.day_of_week <= 5;
        return { ...d, is_active: isWeekday, blocks: singleBlock('08:00', '17:00'), editingBlock: null };
      }
      if (preset === 'weekdays-split') {
        const isWeekday = d.day_of_week >= 1 && d.day_of_week <= 5;
        return { ...d, is_active: isWeekday, blocks: splitBlocks(), editingBlock: null };
      }
      // all-week
      return { ...d, is_active: true, blocks: singleBlock('08:00', '20:00'), editingBlock: null };
    });
    this.days.set(updated);
    this.emitStats();
  }

  copyToAll(): void {
    const activeDay = this.days().find((d) => d.is_active);
    if (!activeDay) return;
    const updated = this.days().map((d) => ({
      ...d,
      is_active: true,
      blocks: activeDay.blocks.map((b, i) => ({ ...b, block_order: i })),
      editingBlock: null,
    }));
    this.days.set(updated);
    this.emitStats();
  }

  save(): void {
    this.saving.set(true);
    const items: any[] = [];
    for (const d of this.days()) {
      if (!d.is_active) continue;
      for (const block of d.blocks) {
        items.push({
          day_of_week: d.day_of_week,
          block_order: block.block_order,
          is_active: true,
          start_time: block.start_time,
          end_time: block.end_time,
        });
      }
    }

    this.reservationsService
      .upsertProviderSchedule(this.providerId(), items)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.toastService.success('Horario guardado'),
        error: () => this.toastService.error('Error al guardar horario'),
      });
  }
}
