import { IsNumber, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CloseDispatchRouteDto {
  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declared_cash: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
