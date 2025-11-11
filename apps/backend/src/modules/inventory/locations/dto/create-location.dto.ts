import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
} from 'class-validator';
import { location_type_enum } from '@prisma/client';

export class CreateLocationDto {
  @IsInt()
  organization_id: number;

  @IsOptional()
  @IsInt()
  store_id?: number;

  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsEnum(location_type_enum)
  type?: location_type_enum;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  address_id?: number;
}
