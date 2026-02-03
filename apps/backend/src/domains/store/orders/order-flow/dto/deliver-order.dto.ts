import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeliverOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  delivery_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  delivered_to?: string;
}
