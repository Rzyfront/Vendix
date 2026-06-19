import {
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsIn,
  IsBoolean,
  ValidateIf,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFromOrderItemDto {
  @IsInt()
  @Min(1)
  order_item_id: number;

  @IsInt()
  @Min(1)
  dispatched_quantity: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  location_id?: number;

  @IsOptional()
  @IsString()
  lot_serial?: string;
}

/**
 * Subset of CreateDispatchRouteDto used when creating a brand-new route inline
 * from the dispatch-note creation flow. Mirrors CreateDispatchRouteDto field
 * names/validators EXCEPT `stops` (stops are derived from the dispatch note),
 * and exposes assistants as a flat list of user ids (`assistant_ids`).
 */
export class NewRouteDto {
  @IsInt()
  @Min(1)
  driver_user_id: number;

  @IsDateString()
  planned_date: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  assistant_ids?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  route_code?: string;

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
  @IsInt()
  @Min(1)
  origin_location_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RouteAssignmentDto {
  @IsIn(['none', 'existing', 'new'])
  mode: 'none' | 'existing' | 'new';

  // route_id required ONLY when mode === 'existing'
  @ValidateIf((o: RouteAssignmentDto) => o.mode === 'existing')
  @IsInt()
  @Min(1)
  route_id?: number;

  // new_route required ONLY when mode === 'new'
  @ValidateIf((o: RouteAssignmentDto) => o.mode === 'new')
  @ValidateNested()
  @Type(() => NewRouteDto)
  new_route?: NewRouteDto;
}

export class CreateFromOrderDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  dispatch_location_id?: number;

  @IsOptional()
  @IsDateString()
  agreed_delivery_date?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['draft', 'confirmed'])
  target_status?: 'draft' | 'confirmed';

  @IsOptional()
  @ValidateNested()
  @Type(() => RouteAssignmentDto)
  route_assignment?: RouteAssignmentDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFromOrderItemDto)
  items: CreateFromOrderItemDto[];
}
