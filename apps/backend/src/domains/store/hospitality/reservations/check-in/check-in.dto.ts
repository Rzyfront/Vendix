import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

/** Physical room picked at check-in for a reservation room still unassigned. */
export class CheckInRoomDto {
  @ApiProperty({ description: 'Habitación de la reserva.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  room_id!: number;

  @ApiProperty({ description: 'Habitación física (101).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unit_id!: number;
}

/** Check-in of an arrival (H3.2). */
export class CheckInDto {
  @ApiProperty({ required: false, type: [CheckInRoomDto], description: 'Habitaciones a asignar al entrar.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckInRoomDto)
  rooms?: CheckInRoomDto[];

  @ApiProperty({ required: false, description: 'Confirma el check-in sobre una habitación sucia.' })
  @IsOptional()
  @IsBoolean()
  confirm_dirty?: boolean;
}
