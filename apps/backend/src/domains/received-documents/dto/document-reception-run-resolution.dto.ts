import { Transform } from 'class-transformer';
import { IsString, MaxLength, Matches, MinLength } from 'class-validator';

export class CancelDocumentReceptionRunDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Matches(/^[^\x00-\x1f\x7f]*$/)
  reason!: string;
}
