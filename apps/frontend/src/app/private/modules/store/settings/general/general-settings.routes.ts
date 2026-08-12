import type { Routes } from '@angular/router';

import { GeneralSettingsStore } from './services/general-settings.store';

/**
 * Definición de una pestaña de Configuración General.
 *
 * `path` es el segmento de ruta y `id` el identificador que el sticky-header
 * usa para marcar la pestaña activa: se mantienen iguales a propósito, así el
 * segmento de la URL alcanza para resolver la selección.
 */
export interface GeneralSettingsTabDef {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: string;
  /**
   * Industria que habilita la pestaña. `undefined` = visible siempre.
   *
   * Es visibilidad, NO autorización: la pestaña se oculta cuando no aplica pero
   * la ruta sigue resolviendo. No hay guard de industria a propósito —
   * `AuthFacade.isRestaurant` sale de una cascada que puede no estar hidratada
   * cuando corre un guard, y guardear sobre estado no hidratado produce
   * redirecciones falsas.
   */
  readonly requiresIndustry?: 'restaurant';
}

/**
 * Los seis grupos de Configuración General, en el orden en que se recorren:
 * primero quién es el negocio, después cómo vende, después cómo mueve la
 * mercancía, y al final lo que sólo se enciende y se olvida.
 *
 * Antes esto era una sola pantalla con 13 secciones apiladas y un rail de
 * pestañas que sólo existía en móvil (`lg:hidden`) y hacía scroll a un ancla.
 * En escritorio no había navegación alguna. Ahora es una navegación sola —las
 * pestañas del sticky-header— en todos los anchos, y cada grupo es una ruta
 * hija con deep-link propio.
 */
export const SETTINGS_TABS: readonly GeneralSettingsTabDef[] = [
  {
    id: 'negocio',
    path: 'negocio',
    label: 'Negocio',
    shortLabel: 'Negocio',
    icon: 'store',
  },
  {
    id: 'venta',
    path: 'venta',
    label: 'Venta',
    shortLabel: 'Venta',
    icon: 'shopping-cart',
  },
  {
    id: 'logistica',
    path: 'logistica',
    label: 'Logística',
    shortLabel: 'Logística',
    icon: 'truck',
  },
  {
    id: 'reservas',
    path: 'reservas',
    label: 'Reservas',
    shortLabel: 'Reservas',
    icon: 'calendar-clock',
  },
  {
    id: 'mesas',
    path: 'mesas',
    label: 'Mesas',
    shortLabel: 'Mesas',
    icon: 'utensils',
    requiresIndustry: 'restaurant',
  },
  {
    id: 'notificaciones',
    path: 'notificaciones',
    label: 'Notificaciones',
    shortLabel: 'Alertas',
    icon: 'bell',
  },
];

export const DEFAULT_SETTINGS_TAB = SETTINGS_TABS[0].path;

/**
 * Rutas de Configuración General.
 *
 * Se enchufan desde `store_admin.routes.ts` con
 * `loadChildren: () => import('./general-settings.routes').then(m => m.GENERAL_SETTINGS_ROUTES)`.
 *
 * **`GeneralSettingsStore` se provee ACÁ y no en `root`.** El borrador sin
 * guardar tiene que sobrevivir al cambio de pestaña —que ahora desmonta la
 * página anterior— y morir al salir del módulo. Un singleton de raíz
 * arrastraría cambios pendientes entre sesiones de la pantalla.
 *
 * El shell se carga con `loadComponent` (import dinámico) para que este archivo
 * no dependa en tiempo de módulo del componente que a su vez importa
 * `SETTINGS_TABS` de acá.
 */
export const GENERAL_SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./general-settings.component').then(
        (c) => c.GeneralSettingsComponent,
      ),
    providers: [GeneralSettingsStore],
    children: [
      // `settings/general` sin sufijo redirige a la pestaña por defecto. De esto
      // dependen los enlaces entrantes que apuntan al módulo sin pestaña:
      // MenuFilterService, BreadcrumbService, vexi-settings.guard,
      // store-module-catalog, el POS y el POP.
      { path: '', pathMatch: 'full', redirectTo: DEFAULT_SETTINGS_TAB },
      {
        path: 'negocio',
        title: 'Negocio - Configuración General',
        loadComponent: () =>
          import('./pages/business-settings.page').then(
            (c) => c.BusinessSettingsPage,
          ),
      },
      {
        path: 'venta',
        title: 'Venta - Configuración General',
        loadComponent: () =>
          import('./pages/sales-settings.page').then((c) => c.SalesSettingsPage),
      },
      {
        path: 'logistica',
        title: 'Logística - Configuración General',
        loadComponent: () =>
          import('./pages/logistics-settings.page').then(
            (c) => c.LogisticsSettingsPage,
          ),
      },
      {
        path: 'reservas',
        title: 'Reservas - Configuración General',
        loadComponent: () =>
          import('./pages/reservations-settings.page').then(
            (c) => c.ReservationsSettingsPage,
          ),
      },
      {
        path: 'mesas',
        title: 'Mesas - Configuración General',
        loadComponent: () =>
          import('./pages/tables-settings.page').then(
            (c) => c.TablesSettingsPage,
          ),
      },
      {
        path: 'notificaciones',
        title: 'Notificaciones - Configuración General',
        loadComponent: () =>
          import('./pages/notifications-settings.page').then(
            (c) => c.NotificationsSettingsPage,
          ),
      },
      { path: '**', redirectTo: DEFAULT_SETTINGS_TAB },
    ],
  },
];
