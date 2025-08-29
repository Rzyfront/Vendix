import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    example: '2025-08-24T12:00:00Z',
    description: 'Último login del usuario (opcional)',
  })
  @IsOptional()
  @IsDateString()
  last_login?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Intentos fallidos de login (opcional)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  failed_login_attempts?: number;

  @ApiPropertyOptional({
    example: '2025-08-25T12:00:00Z',
    description: 'Fecha hasta la que el usuario está bloqueado (opcional)',
  })
  @IsOptional()
  @IsDateString()
  locked_until?: string;
}
