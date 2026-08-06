import { inject } from '@angular/core';
import {
  Router,
  type ActivatedRouteSnapshot,
  type CanActivateFn,
} from '@angular/router';

import {
  TENANT_PROFILE_SCOPE,
  TenantContextStore,
} from '../state/tenant-context.store';

/**
 * Siembra el contexto de tenant antes de que el shell se instancie.
 *
 * **Por qué un guard y no un factory en `Route.providers`.** El
 * `EnvironmentInjector` de una ruta se construye durante el reconocimiento
 * (`getOrCreateRouteInjectorIfNeeded`), antes de que exista el `OutletInjector`
 * que provee `ActivatedRoute`. Un `useFactory` que intentara leer `:storeId`
 * desde ese injector no encontraría la ruta activada y fallaría. El guard, en
 * cambio, recibe el `ActivatedRouteSnapshot` ya resuelto y —esto es lo que hace
 * viable el diseño— se ejecuta DENTRO del injector de su propia ruta:
 * `getClosestRouteInjector()` devuelve `snapshot.routeConfig._injector` para la
 * ruta que declara los `providers`. Así el `TenantContextStore` que el guard
 * siembra es exactamente el mismo que inyectan el shell y sus páginas.
 *
 * Se re-ejecuta al cambiar `:storeId` (el `runGuardsAndResolvers` por defecto
 * es `paramsChange`), de modo que saltar de una ficha a otra vuelve a sembrar.
 */
export const seedTenantContextGuard: CanActivateFn = (route) => {
  const config = inject(TENANT_PROFILE_SCOPE);
  const store = inject(TenantContextStore);
  const router = inject(Router);

  const raw = readParamUpwards(route, config.idParam);
  const tenantId = Number(raw);

  // Un id que ni siquiera es un entero positivo no merece una llamada al
  // backend: no hay ficha que mostrar ni error que explicar más allá de
  // "esa URL no existe". Un id bien formado pero inexistente SÍ llega al
  // backend y termina en el estado de error del shell.
  if (raw === null || !Number.isInteger(tenantId) || tenantId <= 0) {
    return router.parseUrl(config.exitRoute);
  }

  store.seed(tenantId);
  return true;
};

/**
 * Busca el parámetro subiendo por la cadena de snapshots.
 *
 * El guard cuelga de una ruta `path: ''` cuyo padre porta `:storeId`. Con la
 * estrategia de herencia por defecto (`emptyPath`) el parámetro ya estaría
 * disponible, pero recorrer la cadena a mano hace que el guard siga funcionando
 * si alguien reorganiza el árbol o cambia `paramsInheritanceStrategy`.
 */
function readParamUpwards(
  route: ActivatedRouteSnapshot,
  param: string,
): string | null {
  for (
    let cursor: ActivatedRouteSnapshot | null = route;
    cursor;
    cursor = cursor.parent
  ) {
    const value = cursor.paramMap.get(param);
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}
