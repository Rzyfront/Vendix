import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MenuFilterService, PANEL_UI_NO_ACCESS_ROUTE, PANEL_UI_TERMINAL_ROUTE } from '../services/menu-filter.service';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';
import { AccessGateService } from '../services/access-gate.service';
import { PlanPaywallService } from '../services/plan-paywall.service';
import { IndustryPaywallService } from '../services/industry-paywall.service';

/**
 * CanActivate que cierra el bypass de panel_ui en URL directa (A.4 / ADR-4).
 *
 * Corre DESPUÉS de `AuthGuard`. Cuando un usuario con permisos pero con
 * `panel_ui[module]=false` teclea la URL de un módulo, en vez de entrar deja
 * un toast informativo (ERR-10) y lo redirige al primer módulo activo
 * (`firstActiveModuleRoute`), con terminal garantizado.
 *
 * ⚠️ Encuadre: `panel_ui` es UX, NO autorización. Este guard vive en el
 * navegador (Angular). Un actor con el `@Permissions` real —lo único que el
 * backend verifica— sigue pudiendo invocar la API con `panel_ui[x]=false`
 * desde curl/Postman, y eso es esperado y correcto. La defensa de
 * autorización real es A.0 + C.2, no este guard. (vendix-permissions:
 * visibility ⊄ authorization).
 *
 * ⚠️ Terminal: `PANEL_UI_TERMINAL_ROUTE` se deja pasar siempre para que el
 * navegador nunca entre en bucle de redirect; el layout muestra la pantalla
 * de "sin módulos habilitados" cuando el sidebar queda vacío.
 *
 * ⚠️ Owner: el rol `owner` pasa las capas de usuario y tienda sin importar
 * `user_settings.config.panel_ui` (como el filtro, case 7, y
 * `mergePanelUiSoft`). Desde apps-f4 (S4) ya NO salta la industria: en
 * auditoría la compuerta registra y deja pasar; con el flag encendido bloquea.
 *
 * ⚠️ No-access: `PANEL_UI_NO_ACCESS_ROUTE` también se deja pasar siempre;
 * es el terminal del caso "usuario sin módulos activos" (bug C1(2)).
 */
export const panelUiGuard: CanActivateFn = async (
  _route,
  state,
): Promise<boolean> => {
  const authFacade = inject(AuthFacade);
  const menuFilter = inject(MenuFilterService);
  const accessGate = inject(AccessGateService);
  const router = inject(Router);
  const toast = inject(ToastService);
  const paywall = inject(PlanPaywallService);
  const industryPaywall = inject(IndustryPaywallService);

  // Compuertas de escape: la ruta terminal y la ruta "sin acceso" nunca se
  // bloquean. Sin esto, el `firstActiveModuleRedirectGuard` o el propio
  // `panelUiGuard` caerían en bucle al redirigir al terminal.
  if (state.url === PANEL_UI_TERMINAL_ROUTE) return true;
  if (state.url === PANEL_UI_NO_ACCESS_ROUTE) return true;

  // apps-f4: el modo (auditoría / flag encendido) y las industrias vienen del
  // backend. Nunca espera más de 1,5 s; si falla, queda en auditoría.
  await accessGate.ensureLoaded('STORE_ADMIN');

  const tree = menuFilter.currentMenuTree();
  const redirect = (): boolean => {
    const target = menuFilter.firstActiveModuleRoute(tree);
    if (target === state.url) return true; // terminal: nada más activo
    router.navigateByUrl(target);
    return false;
  };

  // Finanzas: a fiscal entry whose wizard stage is not complete has no
  // operable screen, for the owner too. Same rule as the sidebar filter
  // (`FISCAL_STAGE_ROUTE_GATES`); the wizard and setup screens stay open.
  const fiscalStageBlock = menuFilter.fiscalStageBlockForUrl(state.url);
  if (fiscalStageBlock) {
    toast.info(fiscalStageBlock.detail);
    return redirect();
  }

  // ── Veredicto pre-F4 (lo que se aplica en auditoría) ──────────────────
  // El owner sigue pasando las capas de usuario y tienda en URL, como hoy.
  // La industria ya no lo exime: se evalúa abajo en la compuerta (S4).
  if (!authFacade.isOwner()) {
    // Índice pre-F4: las rutas que F4 añade (`MODULE_GATE_ROUTES`) solo
    // alimentan la auditoría y no bloquean.
    const keys = menuFilter.resolveKeysForRoute(state.url);
    // Ruta sin módulo `panel_ui` en el índice vigente → no la bloquea.
    if (keys.length) {
      // A.2 (ADR-02, ERR-03): la industria también cierra la URL directa.
      // El mensaje es el de ERR-03, no el ERR-10 de panel_ui: el bloqueo es
      // estructural (giro de la tienda), no un toggle pedible al admin.
      const hiddenByIndustry = keys.filter((key) => {
        const diagnosis = menuFilter.diagnoseModule(
          key,
          tree.length ? tree : undefined,
        );
        return diagnosis.blockedBy === 'industry';
      });
      if (hiddenByIndustry.length) {
        toast.info(menuFilter.industryBlockMessage(hiddenByIndustry));
        return redirect();
      }

      const hiddenByPanel = keys.some((key) => {
        const diagnosis = menuFilter.diagnoseModule(
          key,
          tree.length ? tree : undefined,
        );
        return (
          diagnosis.blockedBy === 'user_panel_ui' ||
          diagnosis.blockedBy === 'store_panel_ui'
        );
      });
      if (hiddenByPanel) {
        toast.info(
          'Ese módulo no está disponible para tu usuario. Si crees que deberías tenerlo, pídele a tu administrador que lo active.',
        );
        return redirect();
      }
    }
  }

  // ── Compuerta F4: canSeeKey sobre el índice completo de rutas ─────────
  // Auditoría: registra lo que bloquearía y deja pasar. Flag encendido en la
  // tienda: bloquea por industria, owner incluido.
  const gateKeys = menuFilter.resolveGateKeysForRoute(state.url, 'STORE_ADMIN');
  // Llegar aquí significa que el veredicto pre-F4 deja pasar.
  if (menuFilter.applyAccessGate(gateKeys, true, 'url', state.url)) {
    return true;
  }
  // Plan layer (planes-matriz-accesos §3): the module is not in the plan →
  // module paywall, once per module family and session; later attempts get a
  // short notice. Inside the app the user stays where they were; on a first
  // load they land on the first active module (the dashboard is never gated).
  const planLock = menuFilter.planLockForKeys(gateKeys);
  if (planLock) {
    if (!paywall.show(planLock)) toast.info(paywall.notice(planLock));
    return router.navigated ? false : redirect();
  }
  // Industry layer on an always-enforced module (`flows`, `documents`): the
  // industry paywall explains it and, for the owner, links to the settings.
  if (menuFilter.isIndustryLocked(gateKeys)) {
    industryPaywall.show(gateKeys[0]);
    return router.navigated ? false : redirect();
  }
  toast.info(menuFilter.industryBlockMessage(gateKeys));
  return redirect();
};

/**
 * apps-f4 S5: `panelUiGuard` del panel de organización. Antes de F4 ORG_ADMIN
 * no tenía guard de URL, así que el veredicto previo es "deja pasar": en
 * auditoría solo registra lo que bloquearía la compuerta (usuario, techo
 * `organization_settings.panel_ui.ORG_ADMIN` e industria derivada de las
 * tiendas). Con el flag global encendido bloquea solo por industria.
 */
export const orgPanelUiGuard: CanActivateFn = async (
  _route,
  state,
): Promise<boolean> => {
  const menuFilter = inject(MenuFilterService);
  const accessGate = inject(AccessGateService);
  const router = inject(Router);
  const toast = inject(ToastService);
  const paywall = inject(PlanPaywallService);

  await accessGate.ensureLoaded('ORG_ADMIN');
  const keys = menuFilter.resolveGateKeysForRoute(state.url, 'ORG_ADMIN');
  if (menuFilter.applyAccessGate(keys, true, 'url', state.url)) return true;

  // Plan layer: the organization has no plans page, so a notice is enough.
  const planLock = menuFilter.planLockForKeys(keys);
  toast.info(
    planLock
      ? paywall.notice(planLock)
      : menuFilter.industryBlockMessage(keys),
  );
  if (state.url !== '/admin/dashboard') router.navigateByUrl('/admin/dashboard');
  return false;
};

/**
 * B.1 / QUI-740: redirige el `path:''` de `store_admin.routes.ts` al primer
 * módulo activo (`firstActiveModuleRoute`). No crea la función — A.4 la posee;
 * esta guard la CONSUME devolviendo un `UrlTree` (redirect, sin navegación
 * imperativa). Siempre devuelve un `UrlTree`, nunca `true`/`false`, así que la
 * ruta a la que se aplica nunca llega a activar su componente.
 */
export const firstActiveModuleRedirectGuard: CanActivateFn = () => {
  const router = inject(Router);
  const menuFilter = inject(MenuFilterService);
  const target = menuFilter.firstActiveModuleRoute(menuFilter.currentMenuTree());
  return router.createUrlTree([target]);
};

/**
 * R1 (Hotelería): `/admin/hospitality` opens the first daily screen the role
 * can see. Recepción wins, then Limpieza (so the Camarera, whose preset also
 * shows Habitaciones, lands on her task board), then Tarifas. The candidates
 * are explicit because this guard runs before the layout registers its menu
 * tree. Like `firstActiveModuleRedirectGuard`, it always returns a `UrlTree`.
 */
const HOSPITALITY_HOME: MenuItem = {
  label: 'Hotelería',
  icon: '',
  panelUiKey: 'hospitality',
  children: [
    { label: 'Recepción', icon: '', route: '/admin/hospitality/front-desk', panelUiKey: 'hospitality_reservations' },
    { label: 'Limpieza', icon: '', route: '/admin/hospitality/housekeeping', panelUiKey: 'hospitality_rooms' },
    { label: 'Tarifas', icon: '', route: '/admin/hospitality/rates', panelUiKey: 'hospitality_rates' },
  ],
};

export const hospitalityHomeRedirectGuard: CanActivateFn = () => {
  const router = inject(Router);
  const menuFilter = inject(MenuFilterService);
  const target = menuFilter.firstActiveModuleRoute([HOSPITALITY_HOME]);
  // Nothing of Hotelería is visible: fall back to the panel-wide first module.
  const blocked =
    target === PANEL_UI_NO_ACCESS_ROUTE || target === PANEL_UI_TERMINAL_ROUTE;
  return router.createUrlTree([
    blocked
      ? menuFilter.firstActiveModuleRoute(menuFilter.currentMenuTree())
      : target,
  ]);
};
