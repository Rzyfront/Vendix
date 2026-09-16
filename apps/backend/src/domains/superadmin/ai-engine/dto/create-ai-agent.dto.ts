import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsInt,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Las keys de agente son slugs kebab-case (`vexi`, `soporte-menu`), no
 * snake_case como las de `ai_engine_applications`: el plan F4 verifica con
 * `key = soporte-menu` y el `agent_key` viaja en URLs y metadata.
 */
export const AI_AGENT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export class CreateAIAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(AI_AGENT_KEY_PATTERN, {
    message: 'key must be a kebab-case slug (e.g. soporte-menu)',
  })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Key de `ai_engine_applications` que ejecuta el turno. La existencia se
   * valida en servicio (`AIAgentsService`), no con FK (ver `ai_agents` en
   * `schema.prisma`). `null` = el loop usa el prompt propio del agente con la
   * config por defecto.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  app_key?: string | null;

  @IsOptional()
  @IsString()
  system_prompt?: string | null;

  /**
   * Filtro adicional sobre las tools del turno, aplicado ENCIMA de la
   * intersección permisos-del-caller × `tools_allowed` del plan (F3).
   * Vacío = sin filtro adicional. Los nombres desconocidos NO rechazan el
   * request (validación blanda): se aceptan y se registran en warn, porque el
   * catálogo del registry vive en memoria y un deploy con tools nuevas no
   * debe romper el admin.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  allowed_tools?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  max_iterations?: number | null;

  @IsOptional()
  @IsBoolean()
  requires_confirmation_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
