import { PartialType } from '@nestjs/mapped-types';
import { CreateResolutionDto } from './create-resolution.dto';

/**
 * Edición parcial de una resolución.
 *
 * CUIDADO al tocar `CreateResolutionDto`: `PartialType` no solo hace opcionales
 * los campos, también copia los **inicializadores de propiedad** del DTO base
 * (`inheritPropertyInitializers` en `@nestjs/mapped-types`). Un `campo = valor`
 * allá se materializa aquí en cada PATCH que no mande ese campo, y el servicio
 * —que decide con `!== undefined`— lo escribe como si el usuario lo hubiera
 * pedido. Los defectos van en el servicio, nunca como inicializador.
 */
export class UpdateResolutionDto extends PartialType(CreateResolutionDto) {}
