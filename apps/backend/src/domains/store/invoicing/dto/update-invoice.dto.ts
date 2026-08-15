import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateInvoiceDto } from './create-invoice.dto';

/**
 * Actualización de una factura en borrador.
 *
 * POR QUÉ DERIVA DE `CreateInvoiceDto` Y NO SE ESCRIBE APARTE
 * ----------------------------------------------------------
 * Antes era una clase independiente, y la deriva hizo exactamente lo que hace
 * siempre: la creación acumuló validaciones que la actualización nunca recibió.
 * Escribían las MISMAS columnas por dos puertas, una con cotas y otra sin
 * ninguna — `customer_address?: any` sin validador, `currency` sin ISO 4217,
 * `withholding_amount` sin mínimo, `items` sin techo ni piso. Cualquiera que
 * quisiera saltarse la validación de creación solo tenía que crear vacío y
 * actualizar después.
 *
 * Derivando, toda regla nueva que se añada a la creación la hereda la
 * actualización el mismo día. Es la única forma de que no vuelvan a divergir.
 *
 * QUÉ SE OMITE Y POR QUÉ
 * ----------------------
 * · `invoice_type` — el consecutivo ya se asignó desde una resolución atada a
 *   ese tipo de documento. Cambiarlo dejaría una factura numerada con el rango
 *   de otro tipo, que la DIAN rechaza gastando el número.
 * · `resolution_id` — misma razón: el número ya salió de una resolución
 *   concreta. Reapuntarlo no mueve el número ya emitido, solo miente sobre su
 *   origen.
 * · `inline_customer` — crear un cliente como efecto secundario de un PATCH es
 *   otra operación. Si hace falta, se crea por el módulo de clientes.
 *
 * CUIDADO al tocar `CreateInvoiceDto`: `PartialType` no solo hace opcionales
 * los campos, también hereda sus INICIALIZADORES
 * (`inheritPropertyInitializers` en `@nestjs/mapped-types`). Un `campo = valor`
 * allá aparecería aquí como valor por defecto y se escribiría en cada
 * actualización parcial, pisando lo que el usuario no quiso tocar. Hoy
 * `CreateInvoiceDto` no tiene ningún inicializador — verificalo antes de añadir
 * uno. Es la misma advertencia que lleva `UpdateResolutionDto`.
 */
export class UpdateInvoiceDto extends PartialType(
  OmitType(CreateInvoiceDto, [
    'invoice_type',
    'resolution_id',
    'inline_customer',
  ] as const),
) {}
