import { IsString, MinLength, MaxLength } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
