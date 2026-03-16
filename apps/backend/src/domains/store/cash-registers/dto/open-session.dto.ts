import { IsNumber, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class OpenSessionDto {
  @IsInt()
  @Type(() => Number)
  cash_register_id: number;

  @IsNumber()
  @Type(() => Number)
  opening_amount: number;
}
