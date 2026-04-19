import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PayOrderDto } from './pay-order.dto';
import { ShipOrderDto } from './ship-order.dto';
import { DeliverOrderDto } from './deliver-order.dto';

export class FastTrackOrderDto {
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
