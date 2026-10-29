import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Hospitality Suite (H8.4, D12) — a key or access card handed to a guest. */
export class DeliverKeyDto {
  @ApiProperty({ description: 'Llave o tarjeta entregada, como la conoce el hotel ("101-A", "Tarjeta 7").' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Escribe qué llave o tarjeta entregas' })
  @MaxLength(60)
  key_label!: string;

  @ApiProperty({ description: 'Huésped que recibe la llave.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Indica a qué huésped le entregas la llave' })
  @MaxLength(150)
  guest_name!: string;

  @ApiProperty({
    required: false,
    description: 'Habitación de la reserva; se puede omitir si la reserva tiene una sola.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  reservation_room_id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  notes?: string;
}
