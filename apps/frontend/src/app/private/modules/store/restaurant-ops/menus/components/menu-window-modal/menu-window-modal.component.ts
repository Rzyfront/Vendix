import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

/**
 * Contrato público de una ventana de disponibilidad de carta. `day_of_week`
 * usa la convención 0=Domingo .. 6=Sábado; las horas son "HH:mm".
 */
export interface MenuWindowValue {
  /** 0=Domingo .. 6=Sábado. */
  day_of_week: number;
  /** "HH:mm". */
  start_time: string;
  /** "HH:mm". */
  end_time: string;
}

/** Etiquetas de día en español; índice = day_of_week (0=Domingo). */
const DAY_LABELS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

/**
 * Modal para crear/editar una ventana horaria de una carta. Es DUEÑO de sus
 * opciones de día (no las recibe por input). El estado del formulario vive en
 * signals directas (`dayOfWeek`, `startTime`, `endTime`) enlazadas con
 * `[ngModel]`/`(ngModelChange)`; la validez es un `computed` reactivo, así que
 * el botón Guardar se habilita/deshabilita solo. Compara minuto-del-día para
 * exigir `end_time > start_time`.
 */
@Component({
  selector: 'app-menu-window-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
  ],
  templateUrl: './menu-window-modal.component.html',
  styleUrl: './menu-window-modal.component.scss',
})
export class MenuWindowModalComponent {
  /** Visibilidad; se enlaza a `isOpen` del `app-modal` interno. */
  readonly open = input<boolean>(false);
  /** Si viene, abre en modo EDICIÓN precargado; si null, modo CREACIÓN. */
  readonly initialValue = input<MenuWindowValue | null>(null);

  /** Emite la ventana VÁLIDA al confirmar. */
  readonly confirmed = output<MenuWindowValue>();
  /** Emite al cancelar/cerrar. */
  readonly closed = output<void>();

  /** Opciones de día propiedad del componente (0=Domingo .. 6=Sábado). */
  readonly dayOptions: SelectorOption[] = DAY_LABELS.map((label, index) => ({
    value: index,
    label,
  }));

  readonly dayOfWeek = signal<number>(1);
  readonly startTime = signal<string>('08:00');
  readonly endTime = signal<string>('12:00');

  readonly isEditMode = computed<boolean>(() => this.initialValue() != null);
  readonly modalTitle = computed<string>(() =>
    this.isEditMode() ? 'Editar ventana' : 'Agregar ventana',
  );

  /** Válida cuando ambas horas parsean y fin > inicio (minuto-del-día). */
  readonly isValid = computed<boolean>(() => {
    const start = this.toMinutes(this.startTime());
    const end = this.toMinutes(this.endTime());
    if (start == null || end == null) return false;
    return end > start;
  });

  /** Muestra el hint solo cuando ambas horas existen pero fin <= inicio. */
  readonly showTimeError = computed<boolean>(() => {
    const start = this.toMinutes(this.startTime());
    const end = this.toMinutes(this.endTime());
    return start != null && end != null && end <= start;
  });

  /**
   * Precarga el formulario desde `initialValue` (edición) o con valores por
   * defecto (creación). Se invoca desde el evento `opened` del `app-modal`,
   * cuando ya están aplicados los inputs del padre.
   */
  seedForm(): void {
    const initial = this.initialValue();
    if (initial) {
      this.dayOfWeek.set(initial.day_of_week);
      this.startTime.set(initial.start_time);
      this.endTime.set(initial.end_time);
    } else {
      this.dayOfWeek.set(1);
      this.startTime.set('08:00');
      this.endTime.set('12:00');
    }
  }

  /** Normaliza el valor del CVA (`string | number | null`) a `number`. */
  onDayChange(value: string | number | null): void {
    this.dayOfWeek.set(value == null ? 0 : Number(value));
  }

  onStartTimeChange(value: string): void {
    this.startTime.set(value ?? '');
  }

  onEndTimeChange(value: string): void {
    this.endTime.set(value ?? '');
  }

  handleConfirm(): void {
    if (!this.isValid()) return;
    this.confirmed.emit({
      day_of_week: this.dayOfWeek(),
      start_time: this.startTime(),
      end_time: this.endTime(),
    });
  }

  handleClose(): void {
    this.closed.emit();
  }

  /** "HH:mm" -> minuto-del-día (h*60+m); null si el formato es inválido. */
  private toMinutes(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours > 23 ||
      minutes > 59
    ) {
      return null;
    }
    return hours * 60 + minutes;
  }
}
