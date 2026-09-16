import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  app_key?: string;

  /**
   * Key de `ai_agents` que atiende esta conversación (F4). Se persiste en
   * `metadata.agent_key` —columna nueva evitada a propósito: `metadata` ya
   * existe y es nullable, así que aceptar el agente no exige migración—.
   * Kebab-case (`vexi`, `soporte-menu`); la existencia se valida en servicio.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9-]*$/, {
    message: 'agent_key must be a kebab-case slug (e.g. soporte-menu)',
  })
  agent_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
