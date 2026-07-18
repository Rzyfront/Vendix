import {
  IsArray,
  IsInt,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A single (stopId → new sequence) assignment for the reorder operation.
 * `sequence` is the 1-based position the stop should occupy on the map's
 * suggested route.
 */
export class ReorderStopItemDto {
  @IsInt()
  @Min(1)
  stopId: number;

  @IsInt()
  @Min(1)
  sequence: number;
}

/**
 * Body of `PATCH /store/dispatch-routes/:id/stops/reorder`.
 *
 * `order` is the new stop ordering: an array of `{ stopId, sequence }` pairs.
 * The service validates that every `stopId` belongs to the route and that the
 * `sequence` values are unique before persisting the new `stop_sequence` of
 * each parada inside a single `$transaction`.
 */
export class ReorderStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderStopItemDto)
  order: ReorderStopItemDto[];
}
