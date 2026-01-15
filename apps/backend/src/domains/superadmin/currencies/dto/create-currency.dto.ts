import { IsString, IsInt, MinLength, MaxLength, Min, Max, IsOptional, IsEnum, Matches } from 'class-validator';

export enum currency_state_enum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

export class CreateCurrencyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  @Matches(/^[A-Z]{3}$/, { message: 'Currency code must be 3 uppercase letters (ISO 4217 format)' })
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

  @IsOptional()
  @IsEnum(currency_state_enum)
  state?: currency_state_enum;
}
