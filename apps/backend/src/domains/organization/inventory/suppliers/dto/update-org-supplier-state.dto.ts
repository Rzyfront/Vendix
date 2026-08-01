import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { supplier_state_enum } from '@prisma/client';

/**
 * Transición explícita del ciclo de vida del proveedor a nivel organización.
 *
 * `archived` queda fuera del enum aceptado a propósito: archivar exige validar
 * documentos abiertos y tiene un único camino auditado
 * (`DELETE /organization/inventory/suppliers/:id`).
 */
export class UpdateOrgSupplierStateDto {
  @ApiProperty({
    description: 'Nuevo estado del proveedor',
    enum: [supplier_state_enum.active, supplier_state_enum.inactive],
  })
  @IsNotEmpty()
  @IsEnum([supplier_state_enum.active, supplier_state_enum.inactive])
  state: supplier_state_enum;
}
