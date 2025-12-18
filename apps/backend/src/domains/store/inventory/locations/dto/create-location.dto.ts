import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { location_type_enum } from '@prisma/client';
import { CreateAddressDto } from '../../../addresses/dto/index';

export class CreateLocationDto {
  @IsOptional()
  @IsInt()
  organization_id?: number;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address?: CreateAddressDto;
}
