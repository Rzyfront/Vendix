import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class AssignShippingMethodDto {
  @IsInt()
  @Min(1)
  shipping_method_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;

  @IsOptional()
  shipping_cost?: number;

  @IsOptional()
  @IsBoolean()
  auto_calculate?: boolean;
}
