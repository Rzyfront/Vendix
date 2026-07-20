import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent, SpinnerComponent } from '../../../../../../shared/components';

export interface BookingSlot {
  date: string;
  start_time: string;
  end_time: string;
  available_providers: Array<{ id: number; display_name: string; avatar_url?: string | null }>;
  total_available: number;
  total_capacity?: number;
  booked_count?: number;
}

/**
 * SlotGridComponent
 *
 * Picker de slots para el Step 2 ecommerce. Cada slot se pinta con color
 * + ícono según skill `vendix-ui-ux` §6 (verde+check / rojo+X), ayudando al
 * cliente a distinguir slots disponibles de reservados sin ambigüedad.
 *
 * Mobile-first: grid 2 cols en <480px, 3 cols en <768px, 4 cols en ≥768px.
 */
@Component({
  selector: 'app-slot-grid',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './slot-grid.component.html',
  styleUrls: ['./slot-grid.component.scss'],
})
export class SlotGridComponent {
  private readonly http = inject(HttpClient);

  readonly productId = input.required<number>();
  readonly providerId = input<number | null>(null);
  readonly date = input.required<string>();   // YYYY-MM-DD

  readonly slotSelected = output<BookingSlot>();

  readonly loading = signal(true);
  readonly slots = signal<BookingSlot[]>([]);
  readonly selectedKey = signal<string | null>(null);

  /** Group slots by morning/afternoon/evening for the section headers. */
  readonly groupedSlots = computed(() => {
    const buckets = { MANANA: [] as BookingSlot[], TARDE: [] as BookingSlot[], NOCHE: [] as BookingSlot[] };
    for (const s of this.slots()) {
      const hour = parseInt(s.start_time.split(':')[0], 10);
      if (hour < 12) buckets.MANANA.push(s);
      else if (hour < 19) buckets.TARDE.push(s);
      else buckets.NOCHE.push(s);
    }
    return buckets;
  });

  /**
   * Order of the groups for the @for. Defined here (not inline in the
   * template) because Angular's template parser rejects non-ASCII chars
   * like Ñ inside @for expressions, and Ñ escapes are also not
   * resolved by the parser. We use ASCII-only keys here and the labels
   * include the tilde for the rendered UI.
   */
  readonly groupOrder: ReadonlyArray<{ key: 'MANANA' | 'TARDE' | 'NOCHE'; label: string; icon: string }> = [
    { key: 'MANANA', label: 'Mañana', icon: '☀️' },
    { key: 'TARDE',  label: 'Tarde',  icon: '🌤️' },
    { key: 'NOCHE',  label: 'Noche',  icon: '🌙' },
  ];

  constructor() {
    // Re-fetch when date or provider changes
    queueMicrotask(() => this.fetchSlots());
  }

  refresh(): void {
    this.fetchSlots();
  }

  selectSlot(slot: BookingSlot): void {
    if (slot.total_available <= 0) return;
    this.selectedKey.set(`${slot.date}|${slot.start_time}`);
    this.slotSelected.emit(slot);
  }

  formatHour(time: string): string {
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const m = mStr || '00';
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m} ${period}`;
  }

  cuposLabel(slot: BookingSlot): string {
    const n = slot.total_available;
    if (n <= 0) return 'Reservado';
    return `${n} cupo${n === 1 ? '' : 's'}`;
  }

  trackByStartTime(_idx: number, slot: BookingSlot): string {
    return `${slot.date}|${slot.start_time}`;
  }

  private fetchSlots(): void {
    const date = this.date();
    if (!date) return;
    this.loading.set(true);
    let params = new HttpParams().set('date_from', date).set('date_to', date);
    const pid = this.providerId();
    if (pid) params = params.set('provider_id', pid.toString());

    this.http
      .get<any>(
        `${environment.apiUrl}/ecommerce/reservations/availability/${this.productId()}`,
        { params },
      )
      .pipe(map((r) => r.data || r || []))
      .subscribe({
        next: (list: BookingSlot[]) => {
          this.slots.set(list);
          this.loading.set(false);
        },
        error: () => {
          this.slots.set([]);
          this.loading.set(false);
        },
      });
  }
}
