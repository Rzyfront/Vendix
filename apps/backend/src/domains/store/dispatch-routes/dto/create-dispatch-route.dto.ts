import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsBoolean,
  Min,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateStopDto {
  @IsInt()
  @Min(1)
  dispatch_note_id: number;

  @IsInt()
  @Min(1)
  stop_sequence: number;

  @IsOptional()
  @IsBoolean()
  is_extra_route?: boolean;
}

export class CreateDispatchRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  route_code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  driver_user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_driver_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  external_driver_id_number?: string;

  @IsOptional()
  @IsBoolean()
  is_primary_driver_external?: boolean;

  @IsOptional()
  @IsArray()
  assistants?: Array<{
    user_id?: number;
    external_name?: string;
    external_id_number?: string;
    role?: string;
  }>;

  @IsOptional()
  @IsInt()
  @Min(1)
  origin_location_id?: number;

  @IsDateString()
  planned_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStopDto)
  stops: CreateStopDto[];
}
