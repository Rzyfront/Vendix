import {
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
  input,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';
import { BadgeComponent } from '../badge/badge.component';
import { ModalComponent as AppModalComponent } from '../modal/modal.component';
import { ToastService } from '../toast/toast.service';
import { toLocalDateString } from '../../utils/date.util';
import { environment } from '../../../../environments/environment';
import { StepsLineComponent, StepsLineItem } from '../steps-line/steps-line.component';
import { InputsearchComponent } from '../inputsearch/inputsearch.component';

export type SchedulerWizardStep = 'date_time' | 'provider' | 'customer' | 'confirm';
export type CalendarViewMode = 'day' | 'week' | 'month';

interface ProviderOption {
  id: number;
  display_name?: string;
  avatar_url?: string | null;
  employee?: {
    first_name: string;
    last_name?: string;
  };
}

interface SimpleCustomer {
  id: number;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  document_number?: string;
}

interface CalendarDayCell {
  date: Date;
  dateStr: string;
  dayNumber: number;
  dayName: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
}

/**
 * Helper to add minutes to HH:mm string.
 */
function addMinutes(hhmm: string, minutes: number): string {
  if (!hhmm || !hhmm.includes(':')) return hhmm;
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * Helper to compute the default slot based on current local time.
 * Rounds to current / nearest 30-minute boundary within 08:00–20:00 range.
 */
function resolveDefaultCurrentSlot(durationMinutes: number = 30): { start: string; end: string } {
  const now = new Date();
  const currentTotal = now.getHours() * 60 + now.getMinutes();

  const minTotal = 8 * 60; // 08:00 (480 mins)
  const maxTotal = 20 * 60 - durationMinutes; // 20:00 minus duration

  let chosenMinutes: number;
  if (currentTotal <= minTotal) {
    chosenMinutes = minTotal;
  } else if (currentTotal >= maxTotal) {
    chosenMinutes = Math.max(minTotal, maxTotal);
  } else {
    // Round to current 30-min block (e.g. 10:15 -> 10:00; 10:35 -> 10:30)
    const slotStep = 30;
    chosenMinutes = Math.floor(currentTotal / slotStep) * slotStep;
    if (chosenMinutes < minTotal) chosenMinutes = minTotal;
    if (chosenMinutes > maxTotal) chosenMinutes = maxTotal;
  }

  const h = Math.floor(chosenMinutes / 60);
  const m = chosenMinutes % 60;
  const start = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const end = addMinutes(start, durationMinutes);
  return { start, end };
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const WEEK_DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

@Component({
  selector: 'app-booking-scheduler-modal',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    AppModalComponent,
    StepsLineComponent,
    InputsearchComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modalTitle()"
      [showCloseButton]="true"
      size="lg"
      (closed)="onCancel()"
    >
      <div class="flex flex-col gap-3 w-full">
        <!-- Reusable System Steps Line (Compact) -->
        <div class="border-b border-border/60 pb-1 -mt-1 w-full">
          <app-steps-line
            [steps]="wizardSteps()"
            [currentStep]="currentStepIndex()"
            [clickable]="true"
            size="sm"
            (stepClicked)="onStepLineClicked($event)"
          ></app-steps-line>
        </div>

        <!-- STEP 1: FECHA Y HORA (CALENDARIO + TIMELINE DE HORARIOS DIA EN 30M) -->
        @if (currentStep() === 'date_time') {
          <div class="space-y-3 w-full">
            <!-- Barra Superior del Calendario: Vistas, Navegación y Modalidad -->
            <div class="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-xl border border-border/70">
              <!-- Navegación Mes / Día -->
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  (click)="prevPeriod()"
                  class="w-7 h-7 rounded-lg border border-border bg-surface flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                  aria-label="Período anterior"
                >
                  <app-icon name="chevron-left" [size]="14"></app-icon>
                </button>

                <span class="text-xs sm:text-sm font-bold text-text-primary min-w-[115px] text-center">
                  {{ currentCalendarTitle() }}
                </span>

                <button
                  type="button"
                  (click)="nextPeriod()"
                  class="w-7 h-7 rounded-lg border border-border bg-surface flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-muted transition-colors"
                  aria-label="Período siguiente"
                >
                  <app-icon name="chevron-right" [size]="14"></app-icon>
                </button>

                <button
                  type="button"
                  (click)="goToToday()"
                  class="px-2 py-0.5 text-[11px] font-semibold rounded-lg border border-border bg-surface text-primary hover:bg-primary/5 transition-colors"
                >
                  Hoy
                </button>
              </div>

              <!-- Selector de Modos de Vista (Día / Semana / Mes) -->
              <div class="flex items-center gap-0.5 bg-surface p-0.5 rounded-lg border border-border">
                <button
                  type="button"
                  (click)="calendarViewMode.set('month')"
                  class="px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors"
                  [class]="calendarViewMode() === 'month' ? 'bg-primary text-white shadow-xs' : 'text-text-secondary hover:text-text-primary'"
                >
                  Mes
                </button>
                <button
                  type="button"
                  (click)="calendarViewMode.set('week')"
                  class="px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors"
                  [class]="calendarViewMode() === 'week' ? 'bg-primary text-white shadow-xs' : 'text-text-secondary hover:text-text-primary'"
                >
                  Semana
                </button>
                <button
                  type="button"
                  (click)="calendarViewMode.set('day')"
                  class="px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors"
                  [class]="calendarViewMode() === 'day' ? 'bg-primary text-white shadow-xs' : 'text-text-secondary hover:text-text-primary'"
                >
                  Día
                </button>
              </div>

              <!-- Selector de Modalidad (En tienda vs Domicilio) -->
              @if (isHomeServiceEligible()) {
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] font-semibold text-text-secondary">Modalidad:</span>
                  <div class="inline-flex rounded-lg border border-border bg-surface p-0.5">
                    <button
                      type="button"
                      (click)="serviceLocationType.set('shop')"
                      class="px-2 py-0.5 text-xs font-semibold rounded-md flex items-center gap-1 transition-colors"
                      [class]="serviceLocationType() === 'shop' ? 'bg-primary/10 text-primary font-bold' : 'text-text-secondary hover:text-text-primary'"
                    >
                      <app-icon name="store" [size]="12"></app-icon>
                      En tienda
                    </button>
                    <button
                      type="button"
                      (click)="serviceLocationType.set('home')"
                      class="px-2 py-0.5 text-xs font-semibold rounded-md flex items-center gap-1 transition-colors"
                      [class]="serviceLocationType() === 'home' ? 'bg-primary/10 text-primary font-bold' : 'text-text-secondary hover:text-text-primary'"
                    >
                      <app-icon name="truck" [size]="12"></app-icon>
                      A domicilio
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- Cuerpo: Calendario (Izquierda) + Timeline de Horarios Día en 30m (Derecha) -->
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3 w-full items-start">
              <!-- Columna Izquierda: Vista del Calendario Interactivo -->
              <div class="md:col-span-7 space-y-2">
                <!-- VISTA MODO MES -->
                @if (calendarViewMode() === 'month') {
                  <div class="rounded-xl border border-border bg-surface p-2.5 shadow-2xs">
                    <!-- Días de la semana header -->
                    <div class="grid grid-cols-7 gap-1 text-center mb-1">
                      @for (dayName of weekDaysHeader; track dayName) {
                        <span class="text-[10px] font-bold text-text-secondary py-0.5 uppercase">
                          {{ dayName }}
                        </span>
                      }
                    </div>

                    <!-- Días del mes cuadrícula -->
                    <div class="grid grid-cols-7 gap-1 text-center">
                      @for (cell of monthCalendarDays(); track cell.dateStr) {
                        <button
                          type="button"
                          [disabled]="cell.isPast"
                          (click)="onSelectDate(cell.dateStr)"
                          class="h-8 w-full rounded-lg text-xs font-semibold flex flex-col items-center justify-center transition-all relative"
                          [class.opacity-30]="!cell.isCurrentMonth"
                          [class.opacity-40]="cell.isPast"
                          [class.cursor-not-allowed]="cell.isPast"
                          [class.bg-primary]="cell.isSelected"
                          [class.text-white]="cell.isSelected"
                          [class.shadow-xs]="cell.isSelected"
                          [class.ring-2]="cell.isSelected"
                          [class.ring-primary/40]="cell.isSelected"
                          [class.hover:bg-primary/10]="!cell.isSelected && !cell.isPast"
                          [class.text-text-primary]="!cell.isSelected && !cell.isPast"
                          [class.border]="cell.isToday && !cell.isSelected"
                          [class.border-primary]="cell.isToday && !cell.isSelected"
                        >
                          <span>{{ cell.dayNumber }}</span>
                          @if (cell.isToday && !cell.isSelected) {
                            <span class="w-1 h-1 rounded-full bg-primary absolute bottom-0.5"></span>
                          }
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- VISTA MODO SEMANA (STRIP HORIZONTAL) -->
                @if (calendarViewMode() === 'week') {
                  <div class="rounded-xl border border-border bg-surface p-2.5 shadow-2xs space-y-1.5">
                    <span class="text-[11px] font-bold text-text-secondary uppercase">Semana en curso</span>
                    <div class="grid grid-cols-7 gap-1">
                      @for (cell of weekCalendarDays(); track cell.dateStr) {
                        <button
                          type="button"
                          [disabled]="cell.isPast"
                          (click)="onSelectDate(cell.dateStr)"
                          class="py-2.5 px-0.5 rounded-lg text-center flex flex-col items-center justify-center gap-0.5 transition-all"
                          [class.opacity-40]="cell.isPast"
                          [class.cursor-not-allowed]="cell.isPast"
                          [class.bg-primary]="cell.isSelected"
                          [class.text-white]="cell.isSelected"
                          [class.shadow-xs]="cell.isSelected"
                          [class.border]="!cell.isSelected"
                          [class.border-border]="!cell.isSelected"
                          [class.hover:border-primary]="!cell.isSelected && !cell.isPast"
                        >
                          <span class="text-[9px] font-bold uppercase tracking-wider" [class.text-white/80]="cell.isSelected" [class.text-text-secondary]="!cell.isSelected">
                            {{ cell.dayName }}
                          </span>
                          <span class="text-xs font-extrabold">{{ cell.dayNumber }}</span>
                          @if (cell.isToday) {
                            <span class="w-1 h-1 rounded-full" [class.bg-white]="cell.isSelected" [class.bg-primary]="!cell.isSelected"></span>
                          }
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- VISTA MODO DÍA -->
                @if (calendarViewMode() === 'day') {
                  <div class="rounded-xl border border-border bg-surface p-3 shadow-2xs flex items-center justify-between">
                    <div>
                      <span class="text-[10px] font-bold text-text-secondary uppercase">Día Seleccionado</span>
                      <h4 class="text-sm font-extrabold text-text-primary mt-0.5">{{ formattedSelectedDate() }}</h4>
                    </div>
                    <app-badge variant="primary" size="sm">Activo</app-badge>
                  </div>
                }
              </div>

              <!-- Columna Derecha: Timeline del Día (Particionado en 30 minutos) -->
              <div class="md:col-span-5 space-y-1.5">
                <div class="flex items-center justify-between">
                  <label class="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                    Horarios Disponibles
                  </label>
                  <span class="text-[10px] text-primary font-bold">
                    {{ formattedDuration() }} por cita
                  </span>
                </div>

                <!-- Timeline contenedor con scroll interno exclusivo (mismo alto que el calendario) -->
                <div class="rounded-xl border border-border bg-surface shadow-2xs h-[235px] overflow-y-auto divide-y divide-border/40 p-1">
                  @for (slot of availableTimeSlots(); track slot.start) {
                    <button
                      type="button"
                      [id]="'slot-' + slot.start"
                      (click)="onSelectTimeSlot(slot.start)"
                      class="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between text-left group"
                      [class.bg-primary]="startTime() === slot.start"
                      [class.text-white]="startTime() === slot.start"
                      [class.shadow-xs]="startTime() === slot.start"
                      [class.hover:bg-primary/5]="startTime() !== slot.start"
                      [class.text-text-primary]="startTime() !== slot.start"
                    >
                      <div class="flex items-center gap-2">
                        <span class="font-bold font-mono text-xs" [class.text-white]="startTime() === slot.start" [class.text-primary]="startTime() !== slot.start">
                          {{ slot.start }}
                        </span>
                        <span class="text-[10px]" [class.text-white/80]="startTime() === slot.start" [class.text-text-secondary]="startTime() !== slot.start">
                          hasta {{ slot.end }}
                        </span>
                      </div>

                      <div class="flex items-center gap-1 text-[10px]">
                        @if (startTime() === slot.start) {
                          <span class="font-bold flex items-center gap-1 bg-white/20 px-1.5 py-0.5 rounded text-white">
                            <app-icon name="check" [size]="11"></app-icon>
                            Elegido
                          </span>
                        } @else {
                          <span class="text-emerald-600 font-medium flex items-center gap-1 group-hover:underline">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Libre
                          </span>
                        }
                      </div>
                    </button>
                  }
                </div>
              </div>
            </div>

            <!-- Barra de Progreso Dinámica e Informativa (Se llena progresivamente al completar Fecha y Hora) -->
            <div class="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-surface to-emerald-500/5 p-2.5 shadow-2xs space-y-1.5 w-full">
              <!-- Indicador visual de llenado de barra -->
              <div class="flex items-center justify-between text-[11px]">
                <div class="flex items-center gap-1.5 font-bold text-text-primary">
                  <app-icon [name]="step1ProgressPercent() === 100 ? 'calendar-check' : 'calendar'" [size]="14" class="text-primary"></app-icon>
                  <span>{{ formattedSelectedDate() }}</span>
                  @if (isTimeSelected()) {
                    <span class="text-text-secondary">•</span>
                    <span class="text-primary font-mono">{{ startTime() }} – {{ endTime() }}</span>
                    <span class="text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded font-semibold">({{ formattedDuration() }})</span>
                  }
                </div>
                <span class="text-[10px] font-bold" [class.text-emerald-600]="step1ProgressPercent() === 100" [class.text-text-secondary]="step1ProgressPercent() < 100">
                  {{ step1ProgressPercent() === 100 ? '100% Completo' : '50% Fecha seleccionada' }}
                </span>
              </div>

              <!-- Línea de progreso interactiva -->
              <div class="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-500 ease-out"
                  [style.width.%]="step1ProgressPercent()"
                ></div>
              </div>
            </div>

            <!-- Notas de la cita opcional -->
            <div>
              <label class="text-[11px] font-semibold text-text-secondary block mb-1">Notas de la cita (opcional)</label>
              <input
                type="text"
                placeholder="Instrucciones especiales o requerimientos del cliente..."
                class="w-full px-3 py-1.5 rounded-xl border border-border bg-surface text-xs focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
                [ngModel]="notes()"
                (ngModelChange)="notes.set($event)"
              />
            </div>
          </div>
        }

        <!-- STEP 2: PROFESIONAL / ESPECIALISTA -->
        @if (currentStep() === 'provider') {
          <div class="space-y-3 w-full">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-sm font-bold text-text-primary">Selecciona el Profesional</h4>
                <p class="text-xs text-text-secondary">
                  @if (isProviderRequired()) {
                    <span class="text-amber-600 font-semibold">* Requerido:</span> Este servicio exige asignar un especialista.
                  } @else {
                    <span>Opcional:</span> Puedes asignar un profesional específico o dejar asignación libre.
                  }
                </p>
              </div>
              @if (providersLoading()) {
                <span class="text-xs text-text-muted">Cargando especialistas...</span>
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <!-- Opción: Cualquier disponible (si no es obligatorio) -->
              @if (!isProviderRequired()) {
                <div
                  (click)="setProvider(null)"
                  class="p-3 rounded-xl border cursor-pointer transition-all flex items-center gap-3"
                  [class]="!providerId() ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border bg-surface hover:border-primary/40'"
                >
                  <div class="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <app-icon name="users" [size]="18"></app-icon>
                  </div>
                  <div class="min-w-0 flex-1">
                    <h5 class="text-xs font-bold text-text-primary truncate">Cualquiera disponible</h5>
                    <p class="text-[10px] text-text-secondary truncate">Asignación automática</p>
                  </div>
                </div>
              }

              <!-- Lista de especialistas -->
              @for (p of providers(); track p.id) {
                <div
                  (click)="setProvider(p.id)"
                  class="p-3 rounded-xl border cursor-pointer transition-all flex items-center gap-3 provider-card"
                  [class]="providerId() === p.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border bg-surface hover:border-primary/40'"
                >
                  <div class="w-9 h-9 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0 font-bold text-xs">
                    {{ (p.display_name || p.employee?.first_name || 'E').slice(0, 2).toUpperCase() }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <h5 class="text-xs font-bold text-text-primary truncate">
                      {{ p.display_name || (p.employee?.first_name + ' ' + (p.employee?.last_name || '')) }}
                    </h5>
                    <p class="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Disponible
                    </p>
                  </div>
                </div>
              }
            </div>

            @if (providers().length === 0 && !providersLoading()) {
              <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 text-center">
                No hay especialistas registrados específicamente para este servicio. Se asignará automáticamente.
              </div>
            }
          </div>
        }

        <!-- STEP 3: ASIGNAR CLIENTE (TOP 3 + BÚSQUEDA) -->
        @if (currentStep() === 'customer') {
          <div class="space-y-3 w-full">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-sm font-bold text-text-primary">Cliente de la Reserva</h4>
                <p class="text-xs text-text-secondary">
                  Asigna el cliente a la cita (se sincroniza automáticamente con la orden del POS).
                </p>
              </div>
            </div>

            <!-- Cliente actualmente seleccionado -->
            @if (selectedCustomer()) {
              <div class="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-bold text-xs">
                    {{ (selectedCustomer()?.first_name || 'C').slice(0, 1).toUpperCase() }}
                  </div>
                  <div class="min-w-0">
                    <h5 class="text-xs font-bold text-text-primary truncate">
                      {{ selectedCustomer()?.first_name }} {{ selectedCustomer()?.last_name || '' }}
                    </h5>
                    <p class="text-[10px] text-text-secondary truncate">
                      {{ selectedCustomer()?.document_number ? 'Doc: ' + selectedCustomer()?.document_number : (selectedCustomer()?.email || selectedCustomer()?.phone || 'Cliente frecuente') }}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  (click)="selectedCustomer.set(null)"
                  class="text-xs font-semibold text-text-secondary hover:text-destructive underline"
                >
                  Cambiar
                </button>
              </div>
            } @else {
              <!-- Buscador de cliente -->
              <div class="space-y-2.5">
                <app-inputsearch
                  placeholder="Buscar cliente por nombre, documento o teléfono..."
                  size="sm"
                  [showClear]="true"
                  (searchChange)="onCustomerSearch($event)"
                  (clear)="onCustomerSearch('')"
                ></app-inputsearch>

                <!-- Top 3 Clientes Frecuentes -->
                <div>
                  <span class="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5">
                    {{ customerSearchQuery() ? 'Resultados de búsqueda:' : 'Top Clientes Frecuentes:' }}
                  </span>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    @for (c of displayedCustomers(); track c.id) {
                      <div
                        (click)="onSelectCustomer(c)"
                        class="p-2.5 rounded-xl border border-border bg-surface hover:border-primary hover:bg-primary/5 cursor-pointer transition-all flex items-center gap-2.5 customer-card"
                      >
                        <div class="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {{ c.first_name.slice(0, 1) }}
                        </div>
                        <div class="min-w-0 flex-1">
                          <h6 class="text-xs font-semibold text-text-primary truncate">
                            {{ c.first_name }} {{ c.last_name || '' }}
                          </h6>
                          <p class="text-[10px] text-text-secondary truncate">
                            {{ c.phone || c.document_number || c.email || 'Cliente' }}
                          </p>
                        </div>
                      </div>
                    }
                  </div>
                </div>

                <!-- Opción: Continuar como venta anónima / mostrador -->
                <div class="pt-1.5 flex items-center justify-between border-t border-border/50 text-xs">
                  <span class="text-text-secondary">¿Es un cliente ocasional de mostrador?</span>
                  <button
                    type="button"
                    (click)="selectedCustomer.set(null); goToStep('confirm')"
                    class="text-xs font-semibold text-primary hover:underline"
                  >
                    Continuar sin registrar cliente
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <!-- STEP 4: CONFIRMACIÓN Y RESUMEN -->
        @if (currentStep() === 'confirm') {
          <div class="space-y-3 w-full">
            <div class="rounded-2xl bg-gradient-to-br from-violet-500/10 via-primary/5 to-surface border border-primary/20 p-4 space-y-3">
              <div class="flex items-center justify-between border-b border-border/60 pb-2.5">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center shadow-xs">
                    <app-icon name="calendar-check" [size]="16"></app-icon>
                  </div>
                  <div>
                    <h4 class="text-sm font-bold text-text-primary">
                      {{ resolvedProduct()?.name || 'Servicio Agendado' }}
                    </h4>
                    <p class="text-xs text-text-secondary">
                      Duración: {{ formattedDuration() }} | Modalidad: {{ serviceLocationType() === 'home' ? 'A Domicilio' : 'En Tienda' }}
                    </p>
                  </div>
                </div>
                <app-badge variant="success" size="sm">Listo para precargar</app-badge>
              </div>

              <!-- Matriz de datos de la reserva -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div class="p-2.5 rounded-xl bg-surface/80 border border-border/50">
                  <span class="text-[10px] text-text-muted flex items-center gap-1.5 font-semibold">
                    <app-icon name="calendar" [size]="13" class="text-primary"></app-icon>
                    Fecha y Horario
                  </span>
                  <p class="font-bold text-text-primary mt-0.5">
                    {{ formattedSelectedDate() }} | {{ startTime() }} – {{ endTime() }}
                  </p>
                </div>

                <div class="p-2.5 rounded-xl bg-surface/80 border border-border/50">
                  <span class="text-[10px] text-text-muted flex items-center gap-1.5 font-semibold">
                    <app-icon name="user" [size]="13" class="text-violet-600"></app-icon>
                    Especialista Asignado
                  </span>
                  <p class="font-bold text-text-primary mt-0.5">
                    {{ providerName() || 'Cualquiera disponible' }}
                  </p>
                </div>

                <div class="p-2.5 rounded-xl bg-surface/80 border border-border/50">
                  <span class="text-[10px] text-text-muted flex items-center gap-1.5 font-semibold">
                    <app-icon name="users" [size]="13" class="text-primary"></app-icon>
                    Cliente Asignado
                  </span>
                  <p class="font-bold text-text-primary mt-0.5">
                    {{ selectedCustomer() ? (selectedCustomer()?.first_name + ' ' + (selectedCustomer()?.last_name || '')) : 'Cliente Mostrador / Anónimo' }}
                  </p>
                </div>

                <div class="p-2.5 rounded-xl bg-surface/80 border border-border/50">
                  <span class="text-[10px] text-text-muted flex items-center gap-1.5 font-semibold">
                    <app-icon [name]="serviceLocationType() === 'home' ? 'truck' : 'store'" [size]="13" class="text-amber-600"></app-icon>
                    Lugar de Atención
                  </span>
                  <p class="font-bold text-text-primary mt-0.5 flex items-center gap-1.5">
                    <app-icon [name]="serviceLocationType() === 'home' ? 'truck' : 'store'" [size]="14" class="text-text-secondary"></app-icon>
                    {{ serviceLocationType() === 'home' ? 'A domicilio (requiere dirección en orden)' : 'En tienda / local' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- WIZARD ACTIONS MOVED TO MODAL FOOTER SLOT WITH COMPONENT ICON SLOTS -->
      <div slot="footer" class="flex items-center justify-between w-full">
        <!-- Botón Cancelar / Atrás -->
        @if (currentStep() === 'date_time') {
          <app-button variant="outline-danger" size="sm" (clicked)="onCancel()">
            <app-icon slot="icon" name="x" [size]="14"></app-icon>
            Cancelar
          </app-button>
        } @else {
          <app-button variant="outline" size="sm" (clicked)="goPreviousStep()">
            <app-icon slot="icon" name="chevron-left" [size]="14"></app-icon>
            Atrás
          </app-button>
        }

        <!-- Botón Siguiente / Confirmar -->
        <div class="flex items-center gap-2">
          @if (currentStep() !== 'confirm') {
            <app-button
              variant="primary"
              size="sm"
              [disabled]="!canAdvanceStep()"
              (clicked)="goNextStep()"
            >
              Siguiente
              <app-icon slot="icon" name="chevron-right" [size]="14"></app-icon>
            </app-button>
          } @else {
            <app-button
              variant="primary"
              size="sm"
              (clicked)="onFinalConfirm()"
            >
              <app-icon slot="icon" name="check" [size]="14"></app-icon>
              Confirmar y precargar en carrito
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class BookingSchedulerModalComponent {
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toastService = inject(ToastService);

  readonly weekDaysHeader = WEEK_DAYS_SHORT;

  // ── Inputs ──
  readonly product = input<any>(null);
  readonly productVariantId = input<number | null>(null);
  readonly cartItem = input<any>(null);
  readonly existingBooking = input<any>(null);
  readonly modalTitleOverride = input<string | null>(null);
  readonly posCustomer = input<any>(null);

  // ── Outputs ──
  readonly scheduled = output<any>();
  readonly cancelled = output<void>();
  readonly customerSelected = output<any>();

  // ── Wizard State ──
  readonly currentStep = signal<SchedulerWizardStep>('date_time');
  readonly calendarViewMode = signal<CalendarViewMode>('month');

  readonly wizardSteps = computed<StepsLineItem[]>(() => [
    { label: 'Fecha y Hora', completed: this.isDateTimeConfigured() },
    { label: 'Especialista', completed: this.isProviderConfigured() },
    { label: 'Cliente', completed: !!this.selectedCustomer() },
    { label: 'Confirmación', completed: false },
  ]);

  readonly currentStepIndex = computed<number>(() => {
    const s = this.currentStep();
    switch (s) {
      case 'date_time': return 0;
      case 'provider': return 1;
      case 'customer': return 2;
      case 'confirm': return 3;
      default: return 0;
    }
  });

  onStepLineClicked(index: number): void {
    if (index === 0) {
      this.goToStep('date_time');
    } else if (index === 1 && this.isDateTimeConfigured()) {
      this.goToStep('provider');
    } else if (index === 2 && this.isDateTimeConfigured()) {
      this.goToStep('customer');
    } else if (index === 3 && this.canConfirm()) {
      this.goToStep('confirm');
    }
  }

  // ── Calendar Internal Navigation State ──
  readonly cursorDate = signal<Date>(new Date());
  readonly date = signal<string>(toLocalDateString(new Date()));
  readonly startTime = signal<string>(resolveDefaultCurrentSlot(30).start);
  readonly endTime = signal<string>(resolveDefaultCurrentSlot(30).end);
  readonly serviceLocationType = signal<'shop' | 'home'>('shop');
  readonly notes = signal<string>('');
  readonly providerIdText = signal<string>('');

  // ── Providers State ──
  readonly providers = signal<ProviderOption[]>([]);
  readonly providersLoading = signal<boolean>(false);

  // ── Customers State ──
  readonly selectedCustomer = signal<SimpleCustomer | null>(null);
  readonly customerSearchQuery = signal<string>('');
  readonly topCustomers = signal<SimpleCustomer[]>([]);
  readonly searchResults = signal<SimpleCustomer[]>([]);

  // ── Computed Service Properties ──
  readonly resolvedProduct = computed<any>(() => {
    return this.product() ?? this.cartItem()?.product ?? this.existingBooking()?.product ?? null;
  });

  readonly isHomeServiceEligible = computed<boolean>(() => {
    return this.resolvedProduct()?.is_eligible_for_home_service === true;
  });

  readonly isProviderRequired = computed<boolean>(() => {
    return this.resolvedProduct()?.booking_mode === 'provider_required';
  });

  readonly durationMinutes = computed<number>(() => {
    const p = this.resolvedProduct();
    const dur = Number(p?.service_duration_minutes ?? p?.duration_minutes ?? 30);
    return Number.isFinite(dur) && dur > 0 ? dur : 30;
  });

  readonly formattedDuration = computed<string>(() => {
    const total = this.durationMinutes();
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  });

  readonly providerId = computed<number | null>(() => {
    const v = this.providerIdText();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

  readonly providerName = computed<string>(() => {
    const id = this.providerId();
    if (!id) return '';
    const p = this.providers().find((item) => item.id === id);
    return p?.display_name || p?.employee?.first_name || '';
  });

  readonly modalTitle = computed<string>(() => {
    if (this.modalTitleOverride()) return this.modalTitleOverride()!;
    const name = this.resolvedProduct()?.name || 'Servicio';
    return `Agendar ${name}`;
  });

  readonly currentCalendarTitle = computed<string>(() => {
    const d = this.cursorDate();
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  });

  readonly formattedSelectedDate = computed<string>(() => {
    const dStr = this.date();
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayName = WEEK_DAYS_SHORT[dateObj.getDay()];
    const monthName = MONTH_NAMES[dateObj.getMonth()];
    return `${dayName}, ${d} de ${monthName} de ${y}`;
  });

  /** Month view calendar grid cells (42 cells: past month trailing + current + next month leading) */
  readonly monthCalendarDays = computed<CalendarDayCell[]>(() => {
    const cursor = this.cursorDate();
    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const startDayIndex = firstDayOfMonth.getDay(); // 0 = Dom
    const totalDays = lastDayOfMonth.getDate();

    const todayStr = toLocalDateString(new Date());
    const selectedDateStr = this.date();

    const cells: CalendarDayCell[] = [];

    // Días del mes anterior
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, d);
      const dStr = toLocalDateString(prevDate);
      cells.push({
        date: prevDate,
        dateStr: dStr,
        dayNumber: d,
        dayName: WEEK_DAYS_SHORT[prevDate.getDay()],
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        isSelected: dStr === selectedDateStr,
        isPast: dStr < todayStr,
      });
    }

    // Días del mes actual
    for (let d = 1; d <= totalDays; d++) {
      const curDate = new Date(year, month, d);
      const dStr = toLocalDateString(curDate);
      cells.push({
        date: curDate,
        dateStr: dStr,
        dayNumber: d,
        dayName: WEEK_DAYS_SHORT[curDate.getDay()],
        isCurrentMonth: true,
        isToday: dStr === todayStr,
        isSelected: dStr === selectedDateStr,
        isPast: dStr < todayStr,
      });
    }

    // Días del próximo mes para completar filas de 7
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      const dStr = toLocalDateString(nextDate);
      cells.push({
        date: nextDate,
        dateStr: dStr,
        dayNumber: d,
        dayName: WEEK_DAYS_SHORT[nextDate.getDay()],
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        isSelected: dStr === selectedDateStr,
        isPast: false,
      });
    }

    return cells;
  });

  /** Week view calendar days (7 days around current selected or cursor date) */
  readonly weekCalendarDays = computed<CalendarDayCell[]>(() => {
    const cur = new Date(this.cursorDate());
    const dayOfWeek = cur.getDay(); // 0 = Dom
    const sunday = new Date(cur);
    sunday.setDate(cur.getDate() - dayOfWeek);

    const todayStr = toLocalDateString(new Date());
    const selectedDateStr = this.date();
    const cells: CalendarDayCell[] = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const dStr = toLocalDateString(d);
      cells.push({
        date: d,
        dateStr: dStr,
        dayNumber: d.getDate(),
        dayName: WEEK_DAYS_SHORT[d.getDay()],
        isCurrentMonth: true,
        isToday: dStr === todayStr,
        isSelected: dStr === selectedDateStr,
        isPast: dStr < todayStr,
      });
    }
    return cells;
  });

  /** Available dynamic time slots partitioned in 30-minute intervals */
  readonly availableTimeSlots = computed<Array<{ start: string; end: string }>>(() => {
    const dur = this.durationMinutes();
    const slots: Array<{ start: string; end: string }> = [];

    // Particionado en tiempos de media hora entre 08:00 y 20:00
    const startHour = 8;
    const endHour = 20;
    const stepMinutes = 30;

    let currentTotalMinutes = startHour * 60;
    const maxTotalMinutes = endHour * 60;

    while (currentTotalMinutes + dur <= maxTotalMinutes) {
      const h = Math.floor(currentTotalMinutes / 60);
      const m = currentTotalMinutes % 60;
      const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      slots.push({
        start: hhmm,
        end: addMinutes(hhmm, dur),
      });
      currentTotalMinutes += stepMinutes;
    }

    return slots;
  });

  readonly isTimeSelected = computed<boolean>(() => {
    return !!this.startTime() && !!this.endTime() && this.startTime() < this.endTime();
  });

  readonly step1ProgressPercent = computed<number>(() => {
    if (this.date() && this.isTimeSelected()) return 100;
    if (this.date()) return 50;
    return 0;
  });

  readonly isDateTimeConfigured = computed<boolean>(() => {
    return !!this.date() && this.isTimeSelected();
  });

  readonly isProviderConfigured = computed<boolean>(() => {
    if (this.isProviderRequired()) {
      return this.providerId() !== null;
    }
    return true;
  });

  readonly canAdvanceStep = computed<boolean>(() => {
    const step = this.currentStep();
    if (step === 'date_time') return this.isDateTimeConfigured();
    if (step === 'provider') return this.isProviderConfigured();
    if (step === 'customer') return true;
    return true;
  });

  readonly canConfirm = computed<boolean>(() => {
    return this.isDateTimeConfigured() && this.isProviderConfigured();
  });

  readonly displayedCustomers = computed<SimpleCustomer[]>(() => {
    if (this.customerSearchQuery().trim()) {
      return this.searchResults();
    }
    return this.topCustomers();
  });

  constructor() {
    effect(() => {
      const p = this.resolvedProduct();
      const pid = p?.id ?? this.existingBooking()?.product_id;
      if (pid) {
        this.loadProviders(Number(pid));
      }
    });

    effect(() => {
      const eb = this.existingBooking();
      const dur = this.durationMinutes();
      if (eb?.date) {
        const dateStr = String(eb.date).slice(0, 10);
        this.date.set(dateStr);
        const [y, m, d] = dateStr.split('-').map(Number);
        this.cursorDate.set(new Date(y, m - 1, d));
      }
      if (eb?.start_time) {
        this.startTime.set(eb.start_time);
        this.endTime.set(eb.end_time || addMinutes(eb.start_time, dur));
      } else {
        const def = resolveDefaultCurrentSlot(dur);
        this.startTime.set(def.start);
        this.endTime.set(def.end);
      }
      if (eb?.provider_id) {
        this.providerIdText.set(String(eb.provider_id));
      }
      if (eb?.service_location_type) {
        this.serviceLocationType.set(eb.service_location_type);
      }
      if (eb?.notes) {
        this.notes.set(eb.notes);
      }
      this.scrollToSelectedSlot();
    });

    effect(() => {
      const eb = this.existingBooking();
      const item = this.cartItem();
      const posCust = this.posCustomer();

      const custObj =
        eb?.customer ||
        item?.booking?.customer ||
        item?.customer ||
        posCust;

      if (custObj && custObj.id) {
        this.selectedCustomer.set({
          id: custObj.id,
          first_name: custObj.first_name || custObj.name || '',
          last_name: custObj.last_name || '',
          email: custObj.email || '',
          phone: custObj.phone || '',
          document_number: custObj.document_number || '',
        });
      } else {
        const custId =
          eb?.customer_id ||
          item?.booking?.customer_id ||
          item?.customer_id;
        if (custId && !this.selectedCustomer()) {
          this.loadCustomerById(Number(custId));
        }
      }
    });

    this.loadTopCustomers();
    this.scrollToSelectedSlot();
  }

  private loadCustomerById(customerId: number): void {
    if (!customerId) return;
    this.http
      .get<any>(`${environment.apiUrl}/store/customers/${customerId}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          const c = resp?.data ?? resp;
          if (c?.id) {
            this.selectedCustomer.set({
              id: c.id,
              first_name: c.first_name || c.name || '',
              last_name: c.last_name || '',
              email: c.email || '',
              phone: c.phone || '',
              document_number: c.document_number || '',
            });
          }
        },
        error: () => {},
      });
  }

  private scrollToSelectedSlot(): void {
    if (typeof window === 'undefined') return;
    setTimeout(() => {
      const el = document.getElementById(`slot-${this.startTime()}`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 120);
  }

  private loadProviders(productId: number): void {
    this.providersLoading.set(true);
    this.http
      .get<any>(`${environment.apiUrl}/store/reservations/providers/for-service/${productId}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          this.providersLoading.set(false);
          const list = resp?.data ?? resp ?? [];
          this.providers.set(list);
          if (list.length === 1 && this.isProviderRequired() && !this.providerIdText()) {
            this.providerIdText.set(String(list[0].id));
          }
        },
        error: () => {
          this.providersLoading.set(false);
          this.providers.set([]);
        },
      });
  }

  private loadTopCustomers(): void {
    this.http
      .get<any>(`${environment.apiUrl}/store/customers?limit=3`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          const list = resp?.data?.customers ?? resp?.data ?? resp ?? [];
          this.topCustomers.set(
            Array.isArray(list)
              ? list.slice(0, 3).map((c: any) => ({
                  id: c.id,
                  first_name: c.first_name || c.name || 'Cliente',
                  last_name: c.last_name || '',
                  email: c.email || '',
                  phone: c.phone || '',
                  document_number: c.document_number || '',
                }))
              : [],
          );
        },
        error: () => this.topCustomers.set([]),
      });
  }

  onCustomerSearch(query: string): void {
    this.customerSearchQuery.set(query);
    if (!query || query.length < 2) {
      this.searchResults.set([]);
      return;
    }
    this.http
      .get<any>(`${environment.apiUrl}/store/customers?search=${encodeURIComponent(query)}&limit=5`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          const list = resp?.data?.customers ?? resp?.data ?? resp ?? [];
          this.searchResults.set(
            Array.isArray(list)
              ? list.map((c: any) => ({
                  id: c.id,
                  first_name: c.first_name || c.name || 'Cliente',
                  last_name: c.last_name || '',
                  email: c.email || '',
                  phone: c.phone || '',
                  document_number: c.document_number || '',
                }))
              : [],
          );
        },
      });
  }

  onSelectCustomer(c: SimpleCustomer): void {
    this.selectedCustomer.set(c);
    this.customerSelected.emit(c);
    this.goToStep('confirm');
  }

  onSelectDate(dateStr: string): void {
    this.date.set(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    this.cursorDate.set(new Date(y, m - 1, d));

    const todayStr = toLocalDateString(new Date());
    if (dateStr === todayStr && !this.existingBooking()?.start_time) {
      const def = resolveDefaultCurrentSlot(this.durationMinutes());
      this.startTime.set(def.start);
      this.endTime.set(def.end);
    }
    this.scrollToSelectedSlot();
  }

  onSelectTimeSlot(startTime: string): void {
    this.startTime.set(startTime);
    this.endTime.set(addMinutes(startTime, this.durationMinutes()));
    this.scrollToSelectedSlot();
  }

  prevPeriod(): void {
    const cur = new Date(this.cursorDate());
    const mode = this.calendarViewMode();
    if (mode === 'month') {
      cur.setMonth(cur.getMonth() - 1);
    } else if (mode === 'week') {
      cur.setDate(cur.getDate() - 7);
    } else {
      cur.setDate(cur.getDate() - 1);
    }
    this.cursorDate.set(cur);
  }

  nextPeriod(): void {
    const cur = new Date(this.cursorDate());
    const mode = this.calendarViewMode();
    if (mode === 'month') {
      cur.setMonth(cur.getMonth() + 1);
    } else if (mode === 'week') {
      cur.setDate(cur.getDate() + 7);
    } else {
      cur.setDate(cur.getDate() + 1);
    }
    this.cursorDate.set(cur);
  }

  goToToday(): void {
    const today = new Date();
    this.cursorDate.set(today);
    this.date.set(toLocalDateString(today));
    if (!this.existingBooking()?.start_time) {
      const def = resolveDefaultCurrentSlot(this.durationMinutes());
      this.startTime.set(def.start);
      this.endTime.set(def.end);
    }
    this.scrollToSelectedSlot();
  }

  setProvider(id: number | null): void {
    this.providerIdText.set(id ? String(id) : '');
  }

  goToStep(step: SchedulerWizardStep): void {
    this.currentStep.set(step);
  }

  goNextStep(): void {
    const step = this.currentStep();
    if (step === 'date_time') {
      this.currentStep.set('provider');
    } else if (step === 'provider') {
      this.currentStep.set('customer');
    } else if (step === 'customer') {
      this.currentStep.set('confirm');
    }
  }

  goPreviousStep(): void {
    const step = this.currentStep();
    if (step === 'provider') {
      this.currentStep.set('date_time');
    } else if (step === 'customer') {
      this.currentStep.set('provider');
    } else if (step === 'confirm') {
      this.currentStep.set('customer');
    }
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  onFinalConfirm(): void {
    const prodId = this.resolvedProduct()?.id ? Number(this.resolvedProduct()!.id) : undefined;
    const variantId = this.productVariantId() ?? this.cartItem()?.variant_id ?? this.existingBooking()?.product_variant_id ?? undefined;
    const payload = {
      product_id: prodId,
      product_variant_id: variantId,
      booking_id: this.existingBooking()?.id ?? undefined,
      date: this.date(),
      start_time: this.startTime(),
      end_time: this.endTime(),
      provider_id: this.providerId(),
      provider_name: this.providerName() || undefined,
      service_location_type: this.serviceLocationType(),
      notes: this.notes() || undefined,
      customer_id: this.selectedCustomer()?.id ?? undefined,
      customer: this.selectedCustomer() ?? undefined,
    };

    if (this.selectedCustomer()) {
      this.customerSelected.emit(this.selectedCustomer());
    }

    this.scheduled.emit(payload);
  }
}