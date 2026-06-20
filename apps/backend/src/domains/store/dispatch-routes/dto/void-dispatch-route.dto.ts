import { IsString, MaxLength, MinLength, IsOptional } from 'class-validator';

export class VoidDispatchRouteDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  /**
   * Optional free-form notes appended to the stop history entries and the
   * parent route's `notes` field. Mirrors `CloseDispatchRouteDto.notes` for
   * parity. No DB migration needed — `dispatch_routes.notes` already exists.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
