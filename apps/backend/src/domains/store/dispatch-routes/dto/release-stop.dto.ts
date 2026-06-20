import { IsString, IsOptional, MaxLength } from 'class-validator';

export class ReleaseStopDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
