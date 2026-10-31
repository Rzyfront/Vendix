import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateEmailChannelDto {
  @IsBoolean()
  enabled!: boolean;

  /** Visible sender name; the address stays the platform's verified SES sender. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  @Matches(/^[^\r\n"<>]*$/, {
    message: 'from_name no puede tener saltos de línea, comillas ni < >',
  })
  from_name?: string | null;

  /** Where customer replies go (`Reply-To`). */
  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  @MaxLength(160)
  reply_to?: string | null;
}
