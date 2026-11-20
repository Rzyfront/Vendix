import { PartialType, PickType } from '@nestjs/swagger';
import { CreateTransferDto } from './create-transfer.dto';

/**
 * Edición de cabecera de una transferencia pendiente.
 *
 * Solo admite bodegas, fecha límite y notas. Los campos avanzados (modo,
 * destino externo, transporte, vehículo inline, documento soporte) tienen
 * validaciones propias que corren al crear y al despachar: heredarlos de
 * `CreateTransferDto` permitía cambiarlos por PATCH sin ninguna de esas
 * validaciones. Con `forbidNonWhitelisted` el PATCH los rechaza con 400.
 *
 * `items` se conserva solo por compatibilidad de contrato: el servicio lo
 * ignora (las líneas no se editan por este camino).
 */
export class UpdateTransferDto extends PartialType(
  PickType(CreateTransferDto, [
    'from_location_id',
    'to_location_id',
    'expected_date',
    'notes',
    'items',
  ] as const),
) {}
