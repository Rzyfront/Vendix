/**
 * Piezas de UI compartidas por Programación y Agenda (agenda-unificada F1):
 * filtros del dropdown, accesos a la configuración de cada módulo y colores
 * por estado.
 */
import type { StickyHeaderActionButton } from '../../../../../shared/components/sticky-header/sticky-header.component';
import type {
  DropdownAction,
  FilterConfig,
} from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { agendaUrl } from '../scheduling-tabs';
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
    // La agenda mira hacia adelante: «Esta semana / mes / año» llegan hasta el
    // cierre del periodo, no hasta hoy como en reportes.
    filters.push({ key: 'date', label: 'Fecha', type: 'date-range', presetRange: 'fullPeriod' });
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
      // Configuración de disponibilidad: pestaña Configuración de Agenda.
      { label: 'Equipo de servicio', icon: 'user-cog', action: agendaUrl('configuracion', 'equipo') },
      { label: 'Disponibilidad', icon: 'calendar-clock', action: agendaUrl('configuracion', 'disponibilidad') },
      { label: 'Cola de atención', icon: 'users', action: agendaUrl('configuracion', 'cola') },
      { label: 'Horario de la tienda', icon: 'clock', action: agendaUrl('configuracion', 'horario') },
      { label: 'Solicitudes de reagenda', icon: 'inbox', action: '/admin/reservations/reschedule-requests' },
      { label: 'Solicitudes de pago', icon: 'receipt', action: '/admin/reservations/payment-requests' },
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

/**
 * Acceso directo y visible a la configuración de prestadores desde
 * Programación y Agenda: el `id` es la ruta (mismas pantallas de Reservas).
 */
export const PROVIDER_CONFIG_HEADER_ACTIONS: StickyHeaderActionButton[] = [
  { id: agendaUrl('configuracion', 'equipo'), label: 'Equipo de servicio', icon: 'user-cog', variant: 'outline' },
  { id: agendaUrl('configuracion', 'disponibilidad'), label: 'Disponibilidad', icon: 'calendar-clock', variant: 'outline' },
];

/**
 * Otras pantallas de Reservas y Pedidos que no son configuración de
 * disponibilidad: se enlazan desde la pestaña Configuración.
 */
export function schedulingRelatedLinks(flags: {
  bookings: boolean;
  scheduled: boolean;
  service: boolean;
}): { label: string; icon: string; route: string; description: string }[] {
  const links: { label: string; icon: string; route: string; description: string }[] = [];
  if (flags.bookings) {
    links.push(
      { label: 'Solicitudes de reagenda', icon: 'inbox', route: '/admin/reservations/reschedule-requests', description: 'Cambios de hora que piden los clientes' },
      { label: 'Solicitudes de pago', icon: 'receipt', route: '/admin/reservations/payment-requests', description: 'Comprobantes de anticipos por confirmar' },
      { label: 'Ajustes de reservas', icon: 'settings', route: '/admin/settings/general/reservas', description: 'Reglas de reserva, anticipos y confirmaciones' },
    );
    if (flags.service) {
      links.push(
        { label: 'Recordatorios', icon: 'bell', route: '/admin/reservations/reminders', description: 'Próximos servicios por recordar' },
        { label: 'Estaciones', icon: 'warehouse', route: '/admin/services/stations', description: 'Estaciones, sus horarios y excepciones' },
      );
    }
  }
  if (flags.scheduled) {
    links.push(
      { label: 'Producción del día', icon: 'chef-hat', route: '/admin/scheduled-orders/day', description: 'Pedidos programados por preparar' },
      { label: 'Insumos del día', icon: 'package', route: '/admin/scheduled-orders/production', description: 'Insumos consolidados para producir' },
      { label: 'Franjas y cupos de pedidos', icon: 'clock', route: '/admin/settings/general/venta', description: 'Horario, franjas y excepciones de pedidos programados' },
    );
  }
  return links;
}

/** Botón «Reagendas (n)» de la cabecera: lleva a la cola de solicitudes. */
export function rescheduleRequestsAction(count: number, visible: boolean): StickyHeaderActionButton {
  return {
    id: '/admin/reservations/reschedule-requests',
    label: count > 0 ? `Reagendas (${count})` : 'Reagendas',
    icon: 'inbox',
    variant: 'outline',
    visible,
    title:
      count > 0
        ? `Tienes ${count} solicitud(es) de reagenda pendiente(s)`
        : 'No hay solicitudes de reagenda pendientes',
  };
}
