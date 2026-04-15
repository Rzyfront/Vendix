import { IsInt, IsOptional } from 'class-validator';

export class CreateSubmissionDto {
  @IsInt()
  template_id: number;

  @IsOptional()
  @IsInt()
  booking_id?: number;

  @IsOptional()
  @IsInt()
  customer_id?: number;
}
