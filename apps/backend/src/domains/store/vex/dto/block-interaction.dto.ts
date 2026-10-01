import { IsEnum, IsObject } from 'class-validator';

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
}

export class BlockInteractionDto {
  @IsEnum(BlockInteractionType)
  type!: BlockInteractionType;

  /**
   * The interaction payload, shaped by `type`: selected row keys or cell
   * coordinates for `row_select`, the clicked datum for `point_select`, the
   * active filter/sort model for `filter_change`/`sort_change`.
   */
  @IsObject()
  payload!: Record<string, unknown>;
}
