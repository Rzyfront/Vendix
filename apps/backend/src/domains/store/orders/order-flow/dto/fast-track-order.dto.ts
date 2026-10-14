import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PayOrderDto } from './pay-order.dto';
import { ShipOrderDto } from './ship-order.dto';
import { DeliverOrderDto } from './deliver-order.dto';

export class FastTrackOrderDto {
  /** When false, stop after dispatch and leave delivery/finalization pending. */
  @IsOptional()
  @IsBoolean()
  confirm_delivery?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayOrderDto)
  payment?: PayOrderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShipOrderDto)
  ship?: ShipOrderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliverOrderDto)
  deliver?: DeliverOrderDto;
}
