import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ticket_priority_enum } from '@prisma/client';

export class UpdatePqrDto {
  @IsOptional()
  @IsEnum(ticket_priority_enum)
  priority?: ticket_priority_enum;

  @IsOptional()
  @IsInt()
  @Min(1)
  assigned_to_user_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];
}