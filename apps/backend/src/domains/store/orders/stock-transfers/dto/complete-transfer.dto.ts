import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Recepción de una transferencia en tránsito.
 *
 * Existe como CLASE a propósito. El controlador declaraba el body con un tipo
 * literal inline (`{ items: Array<{ id: number; quantity_received: number }> }`),
 * y un tipo estructural no sobrevive a la compilación: `design:paramtypes` queda
 * en `Object` y el `ValidationPipe` global —con `whitelist` y
 * `forbidNonWhitelisted`— no valida nada. El endpoint aceptaba body vacío
 * (reventaba con TypeError al iterar `undefined`), cantidades como string
 * (error de tipo de Prisma como 500) y cantidades negativas o arbitrariamente
 * grandes.
 *
 * El tope contra lo despachado NO vive acá: `quantity_received <= quantity` se
 * valida en el servicio, que es quien conoce la línea.
 */
export class CompleteTransferItemDto {
  @ApiProperty({ description: 'ID de la línea de la transferencia' })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  id!: number;

  @ApiProperty({
    description:
      'Cantidad efectivamente recibida en destino, en unidades de stock',
  })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity_received!: number;
}

export class CompleteTransferDto {
  @ApiProperty({ type: [CompleteTransferItemDto] })
  @IsArray()
  @IsNotEmpty()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompleteTransferItemDto)
  items!: CompleteTransferItemDto[];
}
