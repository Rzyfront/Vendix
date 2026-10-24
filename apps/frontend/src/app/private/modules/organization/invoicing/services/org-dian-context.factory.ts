import type { Provider } from '@angular/core';

import {
  ALL_DIAN_CAPABILITIES,
  DIAN_API_CONTEXT,
  DianConfigApiService,
  type DianApiContext,
} from '../../../../../shared/services/dian';

/** Contexto DIAN apuntado al rail `organization/invoicing`. */
export function createOrgDianContext(): DianApiContext {
  return {
    basePath: () => 'organization/invoicing',
    // La herencia de habilitación sólo existe en el carril de tienda.
    capabilities: () => ({ ...ALL_DIAN_CAPABILITIES, inheritEnablement: false }),
  };
}

/**
 * Providers para que los paneles DIAN compartidos hablen con el rail de
 * organización. `DianConfigApiService` se re-provee a propósito: es
 * `providedIn: 'root'` y resolvería el token desde el injector raíz
 * (`store/invoicing`) ignorando este override.
 */
export function provideOrgDianApi(): Provider[] {
  return [
    { provide: DIAN_API_CONTEXT, useFactory: createOrgDianContext },
    DianConfigApiService,
  ];
}
