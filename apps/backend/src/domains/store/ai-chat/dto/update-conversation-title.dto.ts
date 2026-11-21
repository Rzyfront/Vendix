import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Renombrar una conversación. El título se recorta antes de validar, así un
 * nombre de solo espacios cuenta como vacío y se rechaza.
 */
export class UpdateConversationTitleDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(80, { message: 'title must be at most 80 characters' })
  title!: string;
}
