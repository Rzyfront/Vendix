import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  /**
   * Override por mensaje del agente de la conversación (F4): permite probar
   * un agente (`soporte-menu`) sin crear una conversación nueva. Gana sobre
   * `metadata.agent_key`; no se persiste.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9-]*$/, {
    message: 'agent_key must be a kebab-case slug (e.g. soporte-menu)',
  })
  agent_key?: string;
}
