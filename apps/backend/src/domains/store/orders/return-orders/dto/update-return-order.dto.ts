import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateReturnOrderDto } from './create-return-order.dto';

/**
 * Actualización de una devolución en borrador.
 *
 * `items` queda fuera a propósito: el servicio pasa este DTO tal cual como
 * `data` de un `update`, y una relación anidada en forma de array plano no es
 * una escritura válida de Prisma — llegaba al motor y volvía como «Error
 * interno del servidor». Editar líneas necesita su propio endpoint; mientras no
 * exista, mandarlas devuelve un 400 explícito en vez de un 500.
 */
export class UpdateReturnOrderDto extends PartialType(
  OmitType(CreateReturnOrderDto, ['items'] as const),
) {}
