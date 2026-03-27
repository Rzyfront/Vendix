import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../../../../../../shared/components';
import { CalendarViewMode } from '../../../interfaces/reservation.interface';

@Component({
  selector: 'app-calendar-toolbar',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  templateUrl: './calendar-toolbar.component.html',
  styleUrls: ['./calendar-toolbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarToolbarComponent {
  readonly viewMode = input.required<CalendarViewMode>();
  readonly currentDate = input.required<Date>();
  readonly serviceProducts = input<any[]>([]);

  readonly viewModeChange = output<CalendarViewMode>();
  readonly navigate = output<'prev' | 'next' | 'today'>();
  readonly serviceFilterChange = output<number | null>();
  readonly createNew = output<void>();

  readonly dateLabel = computed(() => {
    const d = this.currentDate();
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    switch (this.viewMode()) {
      case 'month':
        return `${months[d.getMonth()]} ${d.getFullYear()}`;
      case 'week': {
        const startOfWeek = new Date(d);
        startOfWeek.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const shortMonths = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
          'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        if (startOfWeek.getMonth() === endOfWeek.getMonth()) {
          return `${startOfWeek.getDate()} - ${endOfWeek.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        } else {
          return `${startOfWeek.getDate()} ${shortMonths[startOfWeek.getMonth()]} - ${endOfWeek.getDate()} ${shortMonths[endOfWeek.getMonth()]} ${endOfWeek.getFullYear()}`;
        }
      }
      case 'day': {
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
      }
    }
  });

  readonly viewModes: { value: CalendarViewMode; label: string }[] = [
    { value: 'month', label: 'Mes' },
    { value: 'week', label: 'Semana' },
    { value: 'day', label: 'Día' },
  ];
}
