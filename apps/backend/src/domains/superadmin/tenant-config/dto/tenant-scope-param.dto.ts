import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

import type { TenantTarget } from '@common/context/tenant-context-runner.service';
import { ErrorCodes } from '@common/errors/error-codes';
import { VendixHttpException } from '@common/errors/vendix-http.exception';

/**
 * Segmentos `:scope/:tenantId` de la consola de tenants.
 *
 * El plural es obligatorio, no cosmético: `DomainScopeGuard` sólo deja pasar a
 * un token `VENDIX_ADMIN` si la ruta no contiene el literal `/store/`, así que
 * `stores/12` funciona y `store/12` devolvería 403 sin explicación útil.
 */
export type TenantScopeSegment = 'stores' | 'organizations';

export class TenantScopeParamDto {
  @IsIn(['stores', 'organizations'], {
    message: 'scope debe ser "stores" u "organizations"',
  })
  scope!: TenantScopeSegment;

  @Type(() => Number)
  @IsInt({ message: 'tenantId debe ser un entero' })
  @Min(1, { message: 'tenantId debe ser mayor que cero' })
  tenantId!: number;

  toTarget(): TenantTarget {
    return this.scope === 'stores'
      ? { kind: 'store', store_id: this.tenantId }
      : { kind: 'organization', organization_id: this.tenantId };
  }
}

/**
 * Construye el target desde los params sueltos de un handler.
 *
 * Valida el segmento en vez de asumirlo: sin este `throw`, cualquier valor
 * distinto de `stores` caería en la rama de organización y un `/tienda/12` mal
 * escrito acabaría resolviendo la organización 12. Todos los controladores del
 * rail pasan por aquí, así que la comprobación vive en un solo sitio.
 */
export function toTenantTarget(
  scope: string,
  tenantId: number,
): TenantTarget {
  if (scope !== 'stores' && scope !== 'organizations') {
    throw new VendixHttpException(
      ErrorCodes.SYS_VALIDATION_001,
      'El alcance debe ser "stores" u "organizations"',
    );
  }

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new VendixHttpException(
      ErrorCodes.SYS_VALIDATION_001,
      'El identificador del tenant debe ser un entero positivo',
    );
  }

  return scope === 'stores'
    ? { kind: 'store', store_id: tenantId }
    : { kind: 'organization', organization_id: tenantId };
}
