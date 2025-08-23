import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsDateString, IsInt, Min } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsOptional()
  @IsDateString()
  last_login?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  failed_login_attempts?: number;

  @IsOptional()
  @IsDateString()
  locked_until?: string;
}
