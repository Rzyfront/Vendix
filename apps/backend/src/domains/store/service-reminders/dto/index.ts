import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListServiceRemindersDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado del recordatorio (pending, sent, dismissed, all)',
    enum: ['pending', 'sent', 'dismissed', 'all'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Número de página (1-based)', default: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Cantidad de elementos por página', default: 20 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Búsqueda por texto (nombre de cliente o servicio)' })
  @IsOptional()
  @IsString()
  search?: string;
}
