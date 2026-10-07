import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body de `POST plans/:id/reject` y de
 * `POST plans/:id/steps/:step_id/confirmation`: solo la conversación a la que
 * pertenece el plan. La propiedad se verifica en el servicio.
 */
export class PlanConversationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id!: number;
}

/**
 * Body de `POST confirmations/apply` de Vex.
 *
 * Camino nuevo (por paso): `{conversation_id, plan_id, step_id}` más EXACTAMENTE
 * uno de `plan_token` / `confirmation_token`. El servidor toma tool y
 * argumentos del plan persistido; el cliente no los declara.
 *
 * Camino antiguo (compatibilidad): sin `step_id`, con `tool` + `arguments` y el
 * token de plan en `confirmation_token` (más `plan_id`). Un mismo campo
 * `confirmation_token` significa cosas distintas según haya `step_id`, y el
 * controlador es quien las separa; por eso todos los campos son opcionales
 * aquí.
 */
export class ApplyVexStepDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tool must be a snake_case tool identifier',
  })
  tool?: string;

  @IsOptional()
  @IsObject()
  arguments?: Record<string, unknown>;

  /** Token de un solo uso de un paso irreversible (o, en el camino antiguo, el token de plan). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  confirmation_token?: string;

  /** Token del plan aprobado (cubre los pasos reversibles). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  plan_token?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  plan_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  step_id?: string;

  @IsOptional()
  @IsBoolean()
  speak?: boolean;
}
