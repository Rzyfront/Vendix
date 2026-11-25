import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Apps F4 — DTO del handshake de chat de diseño en el constructor de apps.
 * El prompt y el borrador actual viajan en POST (nunca en la URL del SSE).
 */
export class DesignChatStreamIntentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  conversation_id?: number;

  @IsOptional()
  @IsObject()
  draft?: Record<string, unknown>;
}
