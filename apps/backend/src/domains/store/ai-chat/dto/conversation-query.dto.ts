import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ConversationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Filtra por el agente dueño del hilo (`metadata.agent_key`).
   * `vex` → solo hilos de Vex; `vexi` → hilos de Vexi más los legacy sin
   * `agent_key`; cualquier otra key → solo esa. Sin este parámetro el listado
   * conserva su forma de hoy menos los hilos de Vex, para que el dock de Vexi
   * nunca muestre una conversación que no puede abrir.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9-]*$/, {
    message: 'agent_key must be a kebab-case slug (e.g. vex)',
  })
  agent_key?: string;
}
