import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  EmptyStateComponent,
  IconComponent,
  ScrollableTabsComponent,
  SpinnerComponent,
} from '../../../../../../shared/components/index';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ScheduleManagementComponent } from '../../../reservations/components/schedule-management/schedule-management.component';
import { ProviderAvailabilityComponent } from '../../../reservations/components/provider-availability/provider-availability.component';
import { AppointmentQueuePanelComponent } from '../../../reservations/components/appointment-queue-panel/appointment-queue-panel.component';
import { BusinessHoursComponent } from '../../../reservations/components/business-hours/business-hours.component';
import { SchedulingSources } from '../../interfaces/scheduling.interface';
import { SchedulingApiService } from '../../services/scheduling-api.service';
import { ConfigSection } from '../../scheduling-tabs';
import { schedulingRelatedLinks } from '../../utils/scheduling-ui.util';

export const CONFIG_SECTION_TABS: { id: ConfigSection; label: string; icon: string }[] = [
  { id: 'equipo', label: 'Equipo de servicio', icon: 'user-cog' },
  { id: 'disponibilidad', label: 'Disponibilidad', icon: 'calendar-clock' },
  { id: 'cola', label: 'Cola de atención', icon: 'users' },
  { id: 'horario', label: 'Horario de la tienda', icon: 'clock' },
];

/**
 * Agenda → Configuración (agenda-unificada F1). Toda la configuración de
 * disponibilidad de Reservas en un solo lugar, como secciones (capa 4,
 * `app-scrollable-tabs`): prestadores y equipo de servicio (horarios,
 * bloqueos y excepciones), disponibilidad de proveedores, cola de atención y
 * horario del negocio. Monta las pantallas de siempre sin cambiar su lógica.
 * Debajo, enlaces a las demás pantallas de Reservas y Pedidos programados.
 */
@Component({
  selector: 'app-scheduling-config-tab',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    ScrollableTabsComponent,
    SpinnerComponent,
    EmptyStateComponent,
    ScheduleManagementComponent,
    ProviderAvailabilityComponent,
    AppointmentQueuePanelComponent,
    BusinessHoursComponent,
  ],
  template: `
    @if (!sources()) {
      <div class="flex justify-center py-10"><app-spinner /></div>
    } @else {
      @if (hasBookings()) {
        <app-scrollable-tabs
          size="sm"
          ariaLabel="Secciones de configuración"
          [tabs]="sectionTabs"
          [activeTab]="section()"
          (tabChange)="sectionChange.emit($any($event))"
        />
        <div class="mt-3" role="tabpanel" [attr.aria-label]="sectionLabel()">
          @switch (section()) {
            @case ('equipo') {
              <app-schedule-management [embedded]="true" />
            }
            @case ('disponibilidad') {
              <app-provider-availability [embedded]="true" />
            }
            @case ('cola') {
              <app-appointment-queue-panel />
            }
            @case ('horario') {
              <app-business-hours />
            }
          }
        </div>
      } @else {
        <app-empty-state
          icon="user-cog"
          title="Sin reservas de servicio"
          description="Los prestadores y su disponibilidad se configuran cuando la tienda tiene reservas de servicio."
          [showActionButton]="false"
        />
      }

      @if (links().length) {
        <section class="mt-6" aria-label="Otras pantallas">
          <h2 class="mb-2 px-1 text-sm font-semibold text-text-primary">Otras pantallas</h2>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            @for (link of links(); track link.route) {
              <a
                [routerLink]="link.route"
                class="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 no-underline hover:border-primary/25 hover:bg-primary/5"
                [attr.data-route]="link.route"
              >
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary-on-tint">
                  <app-icon [name]="link.icon" [size]="14" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-semibold text-text-primary">{{ link.label }}</span>
                  <span class="block text-xs text-text-secondary">{{ link.description }}</span>
                </span>
              </a>
            }
          </div>
        </section>
      }
    }
  `,
})
export class SchedulingConfigTabComponent {
  private readonly api = inject(SchedulingApiService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  /** Sección activa (`?seccion=`); la escribe el contenedor. */
  readonly section = input.required<ConfigSection>();
  readonly sectionChange = output<ConfigSection>();

  readonly sectionTabs = CONFIG_SECTION_TABS;
  readonly sources = signal<SchedulingSources | null>(null);
  readonly hasBookings = computed(() => !!this.sources()?.types.some((t) => t.value === 'booking'));
  readonly hasScheduled = computed(
    () => !!this.sources()?.types.some((t) => t.value === 'scheduled_order'),
  );
  readonly sectionLabel = computed(
    () => CONFIG_SECTION_TABS.find((t) => t.id === this.section())?.label ?? '',
  );
  readonly links = computed(() =>
    this.sources()
      ? schedulingRelatedLinks({
          bookings: this.hasBookings(),
          scheduled: this.hasScheduled(),
          service: this.auth.isServiceIndustry(),
        })
      : [],
  );

  constructor() {
    this.api
      .getSources()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sources) => this.sources.set(sources),
        // Sin fuentes legibles: se muestra el estado vacío.
        error: () => this.sources.set({ timezone: '', today: '', types: [], status_groups: [], staff: [] }),
      });
  }
}
