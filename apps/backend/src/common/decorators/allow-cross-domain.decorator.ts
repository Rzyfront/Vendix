import { SetMetadata } from '@nestjs/common';

/**
 * @AllowCrossDomain()
 *
 * Excepción estrecha a la REGLA CERO de aislamiento de dominio (DomainScopeGuard).
 *
 * Marca handlers de "bootstrap cross-domain": operaciones que un token de un
 * dominio (p. ej. STORE_ADMIN) debe poder invocar para *transicionar* a otro
 * dominio (p. ej. ORG_ADMIN), aunque el endpoint viva bajo el prefijo del
 * dominio destino (`/organization/*`).
 *
 * Caso canónico: `upgrade-account-type` (SINGLE_STORE → MULTI_STORE_ORG). El
 * owner aún es STORE_ADMIN cuando lo llama; sin esta marca, DomainScopeGuard lo
 * bloquearía con 403 antes de poder ascender a ORG_ADMIN (huevo-y-gallina).
 *
 * Alcance: SOLO salta el cruce de dominio. PermissionsGuard, validación de
 * `owner` a nivel servicio y demás controles siguen activos. Aplicar con
 * parsimonia y solo a endpoints de transición de dominio explícitos.
 */
export const ALLOW_CROSS_DOMAIN_KEY = 'allowCrossDomain';
export const AllowCrossDomain = () =>
  SetMetadata(ALLOW_CROSS_DOMAIN_KEY, true);
