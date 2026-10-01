import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsObject, IsOptional } from 'class-validator';

/**
 * What the person did on a rendered UI block.
 *
 * Recorded server-side so the next turn receives it as context ("the person
 * selected rows 2 and 5, then asked to total them") instead of the model
 * guessing which rows "esas" means.
 */
export enum BlockInteractionType {
  ROW_SELECT = 'row_select',
  POINT_SELECT = 'point_select',
  FILTER_CHANGE = 'filter_change',
  SORT_CHANGE = 'sort_change',
  /** Panel literals (`VexBlockInteraction`): accepted, stored as-is. */
  CHART_CLICK = 'chart_click',
  FILTER = 'filter',
}

export class BlockInteractionDto {
  @IsEnum(BlockInteractionType)
  type!: BlockInteractionType;

  /**
   * The interaction payload, shaped by `type`: selected row keys or cell
   * coordinates for `row_select`, the clicked datum for `point_select`, the
   * active filter/sort model for `filter_change`/`sort_change`.
   *
   * Optional because the panel sends the same content under the kind-specific
   * keys (`selection`, `point`, `filter`); the controller normalizes those
   * into this field.
   */
  // NOTE: every field below carries `@Type(() => Object)`. The global pipe
  // runs with `enableImplicitConversion`, which otherwise "converts" each
  // selected row into an empty array (`[[],[]]`). `Object` keeps them plain.
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  payload?: Record<string, unknown>;

  /** Panel alias of `payload` for `row_select`: the selected rows. */
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  selection?: Array<Record<string, unknown>>;

  /** Panel alias of `payload` for `chart_click`/`point_select`. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  point?: Record<string, unknown>;

  /** Panel alias of `payload` for `filter`/`filter_change`. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  filter?: Record<string, unknown>;
}
