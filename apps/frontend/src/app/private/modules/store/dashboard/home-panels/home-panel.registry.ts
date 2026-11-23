import { Type } from '@angular/core';
import {
  HOME_PANEL_IDS,
  HomePanelId,
} from '../../../../../shared/constants/home-panels';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { IconName } from '../../../../../shared/components/icon/icons.registry';

/**
 * QUI-967 — curated panel of the store "Panel Principal". Closed catalog: each
 * entry reuses an existing screen, lazily loaded only when its tab is active.
 */
export interface HomePanelDefinition {
  id: HomePanelId;
  /** Tab and card title. */
  title: string;
  /** Lucide icon name registered in `icons.registry.ts`. */
  icon: IconName;
  /** Short description shown in the settings cards. */
  description: string;
  /**
   * `MODULE_INDUSTRIES` / panel_ui keys the panel depends on. Empty = always
   * eligible for the store (the "Resumen").
   */
  moduleKeys: readonly string[];
  /** Any of these permissions lets a user see the panel (owner always). */
  permissions: readonly string[];
  /** Extra store-level condition (e.g. a module switched on in settings). */
  storeCondition?: (settings: StoreSettings | null | undefined) => boolean;
  /** Original route for "Abrir módulo completo"; absent for the "Resumen". */
  route?: string;
  /** Lazy component rendered inside the Panel Principal. */
  loadComponent: () => Promise<Type<unknown>>;
}

export const HOME_PANEL_REGISTRY: Readonly<
  Record<HomePanelId, HomePanelDefinition>
> = {
  summary: {
    id: 'summary',
    title: 'Resumen',
    icon: 'layout-dashboard',
    description: 'Indicadores de ventas, gráficos y bitácora de la tienda.',
    moduleKeys: [],
    // The summary uses `canUserAccessDashboard` (roles + these permissions).
    permissions: ['store:dashboard:view', 'store:analytics:read'],
    loadComponent: () =>
      import('../dashboard.component').then((m) => m.DashboardComponent),
  },
  occupancy: {
    id: 'occupancy',
    title: 'Ocupación',
    icon: 'bed-double',
    description: 'Rack hotelero: habitaciones en filas y noches en columnas.',
    moduleKeys: ['hospitality_reservations'],
    permissions: ['store:lodging:reservations:read'],
    route: '/admin/hospitality/rack',
    loadComponent: () =>
      import(
        '../../hospitality/reservations/pages/rack-page/rack-page.component'
      ).then((m) => m.HospitalityRackPageComponent),
  },
  reservations_agenda: {
    id: 'reservations_agenda',
    title: 'Agenda de reservas',
    icon: 'calendar-days',
    description: 'Reservas del día en columnas por profesional.',
    moduleKeys: ['orders_reservations'],
    permissions: ['store:reservations:read'],
    route: '/admin/reservations',
    loadComponent: () =>
      import(
        '../../reservations/components/calendar/provider-day-agenda/provider-day-agenda.component'
      ).then((m) => m.ProviderDayAgendaComponent),
  },
  scheduled_orders_agenda: {
    id: 'scheduled_orders_agenda',
    title: 'Agenda de pedidos',
    icon: 'calendar-clock',
    description: 'Pedidos programados por día y franja de entrega.',
    moduleKeys: ['orders_scheduled'],
    permissions: ['store:scheduled_orders:read'],
    storeCondition: (settings) => settings?.scheduled_orders?.enabled === true,
    route: '/admin/scheduled-orders',
    loadComponent: () =>
      import(
        '../../scheduled-orders/pages/agenda-page/agenda-page.component'
      ).then((m) => m.AgendaPageComponent),
  },
  production: {
    id: 'production',
    title: 'Producción del día',
    icon: 'chef-hat',
    description: 'Órdenes de producción del día y su avance.',
    moduleKeys: ['restaurant_ops_production'],
    permissions: ['store:production_orders:read'],
    route: '/admin/restaurant-ops/production/day',
    loadComponent: () =>
      import(
        '../../restaurant-ops/production/components/production-day-list/production-day-list.component'
      ).then((m) => m.ProductionDayListComponent),
  },
  workflows_board: {
    id: 'workflows_board',
    title: 'Tablero de flujos',
    icon: 'git-branch',
    description: 'Trámites en curso de todos los flujos, por etapa.',
    moduleKeys: ['flows_board'],
    permissions: ['store:workflows:read'],
    route: '/admin/workflows/board',
    loadComponent: () =>
      import('../../workflows/pages/board-all-page/board-all-page.component').then(
        (m) => m.BoardAllPageComponent,
      ),
  },
  crm_pipeline: {
    id: 'crm_pipeline',
    title: 'Pipeline del CRM',
    icon: 'handshake',
    description: 'Oportunidades de venta por etapa del embudo.',
    moduleKeys: ['customers_pipeline'],
    permissions: ['store:crm_pipeline:read'],
    route: '/admin/customers/pipeline',
    loadComponent: () =>
      import('../../customers/crm/pipeline/pipeline.component').then(
        (m) => m.PipelineComponent,
      ),
  },
};

/** Registry entries in catalog order. */
export const HOME_PANELS: readonly HomePanelDefinition[] = HOME_PANEL_IDS.map(
  (id) => HOME_PANEL_REGISTRY[id],
);
