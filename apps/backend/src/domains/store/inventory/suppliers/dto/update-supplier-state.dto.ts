import { IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { supplier_state_enum } from '@prisma/client';

/**
 * Transición explícita del ciclo de vida del proveedor.
 *
 * `archived` queda fuera del enum aceptado a propósito: archivar exige validar
 * documentos abiertos y tiene un único camino auditado
 * (`DELETE /store/inventory/suppliers/:id`).
 */
export class UpdateSupplierStateDto {
  @ApiProperty({
    description: 'Nuevo estado del proveedor',
    enum: [supplier_state_enum.active, supplier_state_enum.inactive],
  })
  @IsNotEmpty()
  @IsIn([supplier_state_enum.active, supplier_state_enum.inactive])
  state: supplier_state_enum;
}
