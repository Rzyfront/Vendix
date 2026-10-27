import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUnitDto } from './create-unit.dto';

export class UpdateUnitDto extends PartialType(CreateUnitDto) {
  @ApiProperty({ required: false, description: 'Inactiva = fuera del conteo vendible.' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
