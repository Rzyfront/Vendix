import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsDateString,
  IsBoolean,
  IsObject,
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

/**
 * One assistant slot. Either an internal store user (user_id) or an external
 * agent (external_name + external_id_number). Exactly one of the two modes is
 * required per slot.
 */
export class CreateAssistantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  external_id_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  role?: string;
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

  /**
   * Optional list of assistants (helpers on the route alongside the driver).
   * Each item must be a well-formed {@link CreateAssistantDto}. Empty arrays
   * are stored as `[]` (NOT `[[]]`/artifacts).
   *
   * Defence in depth: the runtime service in `DispatchRoutesService.create()`
   * re-sanitises and rejects any item missing both `user_id` and
   * `external_*` (which used to slip through as `[]` and persist as a nested
   * empty array on the JSONB column).
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => CreateAssistantDto)
  assistants?: CreateAssistantDto[];

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
