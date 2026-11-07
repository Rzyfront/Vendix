import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { API_KEY_SCOPES } from '../api-key.constants';

export class CreateApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES as unknown as string[], { each: true })
  scopes!: string[];

  /** 1..730 days. Omitted = does not expire. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  expires_in_days?: number;
}
