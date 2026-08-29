import { IsObject, IsOptional } from 'class-validator';

/**
 * Body de POST /store/crm/activate.
 * v1 no recibe configuración: la generación usa la config completa
 * de la tienda/organización ya existente (decisión del plan QUI-719).
 */
export class ActivateCrmDto {}

/**
 * Body de PUT /store/crm/landing — guarda el draft.
 * La validación profunda del contrato de bloques (schema_version, tipos,
 * props por bloque) vive en el validador compartido (PR2) y se aplica en
 * el servicio; aquí se garantiza la forma mínima del payload.
 */
export class UpdateCrmLandingDto {
  @IsObject()
  @IsOptional()
  content_json?: Record<string, unknown>;
}
