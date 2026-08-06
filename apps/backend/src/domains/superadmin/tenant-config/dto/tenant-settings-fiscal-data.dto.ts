import { OmitType } from '@nestjs/mapped-types';
import { ApiSchema } from '@nestjs/swagger';

import { UpdateOrgFiscalDataDto } from '../../../organization/settings/dto/update-org-fiscal-data.dto';

/**
 * Cuerpo del `PATCH /superadmin/tenants/:scope/:tenantId/settings/fiscal-data`.
 *
 * Reusa el DTO de organización en vez de duplicar sus ~20 campos fiscales: el
 * de tienda (`UpdateStoreFiscalDataDto`) declara exactamente el mismo conjunto
 * salvo `store_id`, así que este tipo cubre ambos destinos sin que la consola
 * pueda quedarse atrás cuando se añada un campo fiscal nuevo. Duplicarlo
 * garantizaría lo contrario.
 *
 * `store_id` se OMITE deliberadamente: el tenant se nombra en la ruta
 * (`:scope/:tenantId`) y ya lo resolvió `TenantContextRunner`. Aceptarlo en el
 * cuerpo abriría un segundo canal para elegir destino que podría contradecir
 * la URL — el super admin escribiría el NIT de una tienda distinta a la que
 * está viendo.
 */
@ApiSchema({ name: 'TenantSettingsFiscalDataDto' })
export class TenantSettingsFiscalDataDto extends OmitType(
  UpdateOrgFiscalDataDto,
  ['store_id'] as const,
) {}
