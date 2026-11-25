/**
 * Órdenes → Agenda (agenda-unificada F1, estructura de Rafael 2026-11-23):
 * un solo módulo con cuatro pestañas en `?tab=` (Cola es propia, ya no una
 * sección de Configuración) y, dentro de Configuración, una sección en
 * `?seccion=`. Sin dependencias de componentes: lo importan
 * las rutas (redirecciones de URLs viejas) y las pantallas.
 */
export const AGENDA_ROUTE = '/admin/orders/agenda';

export const AGENDA_TABS = ['calendario', 'programacion', 'cola', 'configuracion'] as const;
export type AgendaTab = (typeof AGENDA_TABS)[number];
export const DEFAULT_AGENDA_TAB: AgendaTab = 'calendario';

export const CONFIG_SECTIONS = ['equipo', 'disponibilidad', 'horario'] as const;
export type ConfigSection = (typeof CONFIG_SECTIONS)[number];
export const DEFAULT_CONFIG_SECTION: ConfigSection = 'equipo';

export function toAgendaTab(value: string | null | undefined): AgendaTab {
  return (AGENDA_TABS as readonly string[]).includes(value ?? '')
    ? (value as AgendaTab)
    : DEFAULT_AGENDA_TAB;
}

export function toConfigSection(value: string | null | undefined): ConfigSection {
  return (CONFIG_SECTIONS as readonly string[]).includes(value ?? '')
    ? (value as ConfigSection)
    : DEFAULT_CONFIG_SECTION;
}

/** Query params de una pestaña (y sección de Configuración). */
export function agendaQueryParams(
  tab: AgendaTab,
  section?: ConfigSection,
): Record<string, string> {
  return section ? { tab, seccion: section } : { tab };
}

/** URL absoluta de una pestaña, para `navigateByUrl` y acciones del dropdown. */
export function agendaUrl(tab: AgendaTab, section?: ConfigSection): string {
  const params = new URLSearchParams(agendaQueryParams(tab, section));
  return `${AGENDA_ROUTE}?${params.toString()}`;
}
