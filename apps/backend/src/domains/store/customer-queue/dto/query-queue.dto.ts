import { IsOptional, IsString } from 'class-validator';

export class QueryQueueDto {
  @IsOptional()
  @IsString()
  status?: string;
}
