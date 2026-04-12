import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RefundExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
