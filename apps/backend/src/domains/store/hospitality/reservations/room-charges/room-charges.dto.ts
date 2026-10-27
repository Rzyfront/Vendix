import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** H3.6 — rooms with a guest in house that POS and tables can charge. */
export class InHouseRoomsQueryDto {
  /** Room number or guest name. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}

/**
 * H3.6 — charge a POS sale (`order_id`, saved as a draft) or a table bill
 * (`table_session_id`) to an in-house room. Exactly one source.
 */
export class CreateRoomChargeDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  reservation_room_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  order_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  table_session_id?: number;
}
