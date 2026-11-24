/**
 * Piezas de UI compartidas por Programación y Agenda (agenda-unificada F1):
 * filtros del dropdown, accesos a la configuración de cada módulo y colores
 * por estado.
 */
import type {
  DropdownAction,
  FilterConfig,
} from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import type {
  SchedulingSources,
  SchedulingStatusGroup,
} from '../interfaces/scheduling.interface';

/** Color (token) por grupo de estado, para los badges de tabla y tarjeta. */
export const STATUS_GROUP_COLOR: Record<SchedulingStatusGroup, string> = {
  pending: 'var(--color-warning)',
  confirmed: 'var(--color-info)',
  in_progress: 'var(--color-primary)',
  completed: 'var(--color-success)',
  cancelled: 'var(--color-text-muted)',
  no_show: 'var(--color-error)',
};

/**
 * Filtros del dropdown. Cada filtro aparece solo si aporta: el de tipo con
 * dos fuentes o más, el de personal cuando hay proveedores.
 */
export function buildSchedulingFilters(
  sources: SchedulingSources | null,
  options: { withDateRange: boolean; withShow: boolean },
): FilterConfig[] {
  if (!sources) return [];
  const filters: FilterConfig[] = [];
  if (options.withShow) {
    filters.push({
      key: 'show',
      label: 'Mostrar',
      type: 'select',
      options: [
        { value: '', label: 'Próximos (desde hoy)' },
        { value: 'all', label: 'Todo, lo más reciente primero' },
      ],
      helpText: 'Con un rango de fechas manda el rango.',
    });
  }
  if (sources.types.length > 1) {
    filters.push({
      key: 'types',
      label: 'Tipo',
      type: 'multi-select',
      options: sources.types.map((t) => ({ value: t.value, label: t.label })),
      placeholder: 'Todos los tipos',
    });
  }
  filters.push({
    key: 'status_groups',
    label: 'Estado',
    type: 'multi-select',
    options: sources.status_groups.map((s) => ({ value: s.value, label: s.label })),
    placeholder: 'Todos los estados',
  });
  if (sources.staff.length) {
    filters.push({
      key: 'staff_ids',
      label: 'Personal',
      type: 'multi-select',
      options: sources.staff.map((s) => ({ value: String(s.id), label: s.name })),
      placeholder: 'Todo el personal',
      helpText: 'Los pedidos programados no tienen personal asignado.',
    });
  }
  if (options.withDateRange) {
    filters.push({ key: 'date', label: 'Fecha', type: 'date-range' });
  }
  return filters;
}

/**
 * Accesos a la configuración y pantallas propias de cada módulo. La `action`
 * es la ruta de destino (o un id que la pantalla resuelve).
 */
export function schedulingConfigActions(flags: {
  bookings: boolean;
  scheduled: boolean;
  service: boolean;
}): DropdownAction[] {
  const actions: DropdownAction[] = [];
  if (flags.bookings) {
    actions.push(
      { label: 'Equipo de servicio', icon: 'user-cog', action: '/admin/reservations/schedules' },
      { label: 'Disponibilidad', icon: 'calendar-clock', action: '/admin/reservations/availability' },
      { label: 'Cola de atención', icon: 'users', action: '/admin/reservations/queue' },
      { label: 'Solicitudes de reagenda', icon: 'inbox', action: '/admin/reservations/reschedule-requests' },
      { label: 'Solicitudes de pago', icon: 'receipt', action: '/admin/reservations/payment-requests' },
      { label: 'Horario del negocio', icon: 'clock', action: '/admin/reservations/business-hours' },
      { label: 'Exportar reservas', icon: 'download', action: 'export-bookings' },
    );
    if (flags.service) {
      actions.push(
        { label: 'Recordatorios', icon: 'bell', action: '/admin/reservations/reminders' },
        { label: 'Estaciones', icon: 'warehouse', action: '/admin/services/stations' },
      );
    }
  }
  if (flags.scheduled) {
    actions.push(
      { label: 'Producción del día', icon: 'chef-hat', action: '/admin/scheduled-orders/day' },
      { label: 'Insumos del día', icon: 'package', action: '/admin/scheduled-orders/production' },
    );
  }
  return actions;
}
