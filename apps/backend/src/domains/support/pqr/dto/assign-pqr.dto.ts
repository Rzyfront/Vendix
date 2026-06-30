import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AssignPqrDto {
  @IsInt()
  @Min(1)
  assigned_to_user_id!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}