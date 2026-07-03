import { IsInt } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for a manual occupancy (aforo) adjustment. `delta` is added to the
 * current count (may be negative); the service floors the result at 0.
 */
export class AdjustOccupancyDto {
  @Type(() => Number)
  @IsInt()
  delta!: number;
}
