import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class SetMappingOverrideDto {
  @IsNumber()
  @Type(() => Number)
  account_id: number;
}
