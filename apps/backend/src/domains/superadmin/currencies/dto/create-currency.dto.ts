import {
  IsString,
  IsInt,
  MinLength,
  MaxLength,
  Min,
  Max,
  IsOptional,
  IsEnum,
  Matches,
} from 'class-validator';

export enum currency_state_enum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

export enum currency_position_enum {
  BEFORE = 'before',
  AFTER = 'after',
}

export enum currency_format_style_enum {
  COMMA_DOT = 'comma_dot',
  DOT_COMMA = 'dot_comma',
  SPACE_COMMA = 'space_comma',
}

export class CreateCurrencyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  @Matches(/^[A-Z]{3}$/, {
    message: 'Currency code must be 3 uppercase letters (ISO 4217 format)',
  })
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  symbol: string;

  @IsInt()
  @Min(0)
  @Max(4)
  decimal_places: number;

  @IsEnum(currency_position_enum)
  @IsOptional()
  position?: currency_position_enum; // Viene de AppNexus (opcional, usa valor de API si no se proporciona)

  @IsEnum(currency_format_style_enum)
  @IsOptional()
  format_style?: currency_format_style_enum;

  @IsOptional()
  @IsEnum(currency_state_enum)
  state?: currency_state_enum;
}
