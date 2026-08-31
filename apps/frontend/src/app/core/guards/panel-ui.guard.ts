import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { MenuFilterService, PANEL_UI_TERMINAL_ROUTE } from '../services/menu-filter.service';
import { ToastService } from '../../shared/components/toast/toast.service';

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
 */
export const panelUiGuard: CanActivateFn = (_route, state): boolean => {
  const menuFilter = inject(MenuFilterService);
  const router = inject(Router);
  const toast = inject(ToastService);

  // Compuerta de escape: la ruta terminal nunca se bloquea.
  if (state.url === PANEL_UI_TERMINAL_ROUTE) return true;

  const tree = menuFilter.currentMenuTree();
  const keys = menuFilter.resolveKeysForRoute(state.url);
  // Ruta sin módulo `panel_ui` (p. ej. el shell /admin, una ruta de detalle
  // sin gobernante propio) → no la gobierna este guard.
  if (!keys.length) return true;

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

  if (!hiddenByPanel) return true;

  toast.info(
    'Ese módulo no está disponible para tu usuario. Si crees que deberías tenerlo, pídele a tu administrador que lo active.',
  );
  const target = menuFilter.firstActiveModuleRoute(tree);
  if (target === state.url) return true; // terminal: nada más activo
  router.navigateByUrl(target);
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
