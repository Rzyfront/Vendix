import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MenuFilterService } from '../../../../core/services/menu-filter.service';
import { PlanPaywallService } from '../../../../core/services/plan-paywall.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import {
  AGENDA_ROUTE,
  agendaQueryParams,
  type AgendaTab,
  type ConfigSection,
} from './scheduling-tabs';

/** Módulos que reúne Órdenes → Agenda (mismo `panelUiAnyOf` del menú). */
export const AGENDA_MODULE_KEYS = ['orders_reservations', 'orders_scheduled'] as const;

/**
 * Agenda unificada F1: la URL de Agenda (y las viejas de Reservas y Pedidos
 * programados, que redirigen aquí) abre solo si al menos uno de sus módulos
 * pasa todas las capas para el usuario: panel de usuario y de tienda,
 * industria y plan. Es el cierre de URL que antes hacía `panelUiGuard` sobre
 * `/admin/reservations` y `/admin/scheduled-orders`. Dentro, cada parte se
 * muestra solo con su key (`SchedulingApiService.getSources`).
 */
export const agendaAccessGuard: CanActivateFn = () => {
  const menuFilter = inject(MenuFilterService);
  const keys = [...AGENDA_MODULE_KEYS];
  if (menuFilter.openAnyOfKeys(keys, 'url').length) return true;

  const router = inject(Router);
  const toast = inject(ToastService);
  const paywall = inject(PlanPaywallService);
  const fallback = () => router.parseUrl(menuFilter.firstActiveModuleRoute(menuFilter.currentMenuTree()));

  // Capa plan: el paywall del módulo, como en `panelUiGuard`.
  const planLock = menuFilter.planLockForKeys(keys);
  if (planLock) {
    if (!paywall.show(planLock)) toast.info(paywall.notice(planLock));
    return router.navigated ? false : fallback();
  }
  toast.info(
    'La Agenda no está disponible para tu usuario. Si crees que deberías tenerla, pídele a tu administrador que active Reservas o Pedidos programados.',
  );
  return router.navigated ? false : fallback();
};

/**
 * Redirección de una URL vieja a su pestaña de Agenda. Las secciones de
 * Configuración son de Reservas: si el usuario no tiene Reservas abierto
 * (panel, tienda, industria o plan), la URL vieja cae en el Calendario, donde
 * solo ve lo que sí tiene; `agendaAccessGuard` decide si entra.
 */
export function agendaTabRedirect(tab: AgendaTab, section?: ConfigSection) {
  const router = inject(Router);
  if (section && !inject(MenuFilterService).openAnyOfKeys(['orders_reservations'], 'url').length) {
    return router.createUrlTree([AGENDA_ROUTE], { queryParams: agendaQueryParams('calendario') });
  }
  return router.createUrlTree([AGENDA_ROUTE], { queryParams: agendaQueryParams(tab, section) });
}
