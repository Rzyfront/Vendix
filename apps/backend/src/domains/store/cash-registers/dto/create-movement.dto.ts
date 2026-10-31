import {
  IsNumber,
  IsString,
  IsOptional,
  IsIn,
  IsPositive,
  Max,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Tope por movimiento manual de caja (B13). */
export const MAX_MANUAL_MOVEMENT_AMOUNT = 1_000_000_000;

export class CreateMovementDto {
  @IsIn(['cash_in', 'cash_out'])
  type: 'cash_in' | 'cash_out';

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_MANUAL_MOVEMENT_AMOUNT)
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  reference?: string;

  // Un egreso sin motivo no es auditable: notes es obligatorio en cash_out.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((o) => o.type === 'cash_out')
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
