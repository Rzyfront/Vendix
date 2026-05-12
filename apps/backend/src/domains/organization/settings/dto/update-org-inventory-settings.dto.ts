import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';

/**
 * DTO para actualizar la sección `inventory` de `organization_settings`.
 *
 * Reglas de validación (§6.4.2 Plan Unificado):
 * - `costing_method` ∈ {`weighted_average`, `fifo`}.
 * - `lifo` está prohibido y se rechaza con BadRequest a nivel class-validator.
 * - El valor legacy `cpp` (proveniente del setting store) se rechaza también
 *   a nivel ORG — el mapping `cpp -> weighted_average` ocurre solamente en
 *   el resolver, nunca se persiste a nivel organización.
 */
@ApiSchema({ name: 'UpdateOrgInventorySettingsDto' })
export class UpdateOrgInventorySettingsDto {
  @ApiPropertyOptional({
    enum: ['weighted_average', 'fifo'],
    description:
      'Método de costeo a nivel organización. LIFO no está soportado.',
  })
  @IsOptional()
  @IsEnum(['weighted_average', 'fifo'] as const, {
    message:
      'costing_method debe ser weighted_average o fifo. LIFO no está soportado y cpp es un valor legacy que sólo aplica a stores.',
  })
  costing_method?: 'weighted_average' | 'fifo';
}
