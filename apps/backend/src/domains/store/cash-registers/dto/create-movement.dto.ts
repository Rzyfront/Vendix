import { IsNumber, IsString, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMovementDto {
  @IsIn(['cash_in', 'cash_out'])
  type: 'cash_in' | 'cash_out';

  @IsNumber()
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
