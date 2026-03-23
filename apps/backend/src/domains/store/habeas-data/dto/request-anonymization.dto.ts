import { IsString, MinLength } from 'class-validator';

export class RequestAnonymizationDto {
  @IsString()
  @MinLength(10)
  reason: string;
}
