import { PartialType } from '@nestjs/mapped-types';
import { CreateOrgInvoiceResolutionDto } from './create-org-invoice-resolution.dto';

/**
 * Edición parcial de una resolución por el carril de organización.
 *
 * CUIDADO al tocar `CreateOrgInvoiceResolutionDto` o su base
 * `CreateResolutionDto`: `PartialType` no sólo hace opcionales los campos,
 * también copia los **inicializadores de propiedad** del DTO base
 * (`inheritPropertyInitializers` en `@nestjs/mapped-types`), y lo hace a través
 * de toda la cadena de herencia. Un `campo = valor` en cualquiera de las dos
 * clases se materializa aquí en cada PATCH que no mande ese campo, y el servicio
 * —que decide con `!== undefined`— lo escribe como si el usuario lo hubiera
 * pedido.
 *
 * El caso concreto que esto evita: un `is_active = true` en el DTO de alta hacía
 * que cualquier PATCH que sólo tocara, por ejemplo, la clave técnica REACTIVARA
 * en silencio una resolución que el comerciante había retirado — volviéndola
 * elegible otra vez para `generateNextNumber`. Ninguna de las dos clases lleva
 * inicializadores hoy, y `invoice-resolutions.service.spec.ts` lo fija con una
 * prueba para que no vuelvan a colarse. Los defectos van en el servicio.
 */
export class UpdateOrgInvoiceResolutionDto extends PartialType(
  CreateOrgInvoiceResolutionDto,
) {}
