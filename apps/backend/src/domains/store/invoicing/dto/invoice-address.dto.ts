import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Dirección fiscal del adquiriente, tipada.
 *
 * Hasta QUI-690 el campo era `customer_address?: any`. Un `any` es el único
 * agujero que `whitelist: true` no tapa: la propiedad está declarada, así que
 * `forbidNonWhitelisted` la deja pasar, pero al no tener validadores nada la
 * recorta ni la revisa. Entraba entera a la columna `Json` de `invoices` y de
 * ahí a `DianDirectProvider.normalizeAddress()`, que lee `city_code` y
 * `department_code` para `cac:PhysicalLocation`. Un código DANE mal escrito no
 * falla aquí: falla en la DIAN, ya quemado el consecutivo autorizado.
 *
 * Los nombres de campo NO son un contrato nuevo: son exactamente los que
 * `normalizeAddress()` ya consume en
 * `providers/dian-direct/dian-direct.provider.ts`.
 */
export class InvoiceAddressDto {
  /**
   * Dirección literal (`cbc:AddressLine/cbc:Line` en el UBL). Es lo único
   * obligatorio: si el cliente decidió mandar dirección, mandarla vacía no
   * comunica nada y deja el XML con un `AddressLine` en blanco.
   */
  @IsString({
    message: 'customer_address.address_line debe ser texto (ej. "Cra 43A # 1-50").',
  })
  @IsNotEmpty({
    message:
      'customer_address.address_line no puede ir vacío. Escribe la dirección del adquiriente o no envíes customer_address en absoluto.',
  })
  @MaxLength(255, {
    message:
      'customer_address.address_line no puede superar 255 caracteres. Resume la dirección; los detalles de entrega van en las notas.',
  })
  address_line: string;

  /**
   * Código DANE del municipio, 5 dígitos (2 de departamento + 3 de municipio).
   * Es lo que la DIAN valida en `cbc:ID` de `cac:CityName`; el nombre de la
   * ciudad es informativo y no sustituye al código.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}$/, {
    message:
      'customer_address.city_code debe ser el código DANE de municipio de 5 dígitos (ej. "05001" = Medellín). No envíes el nombre de la ciudad aquí: eso va en city_name.',
  })
  city_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, {
    message: 'customer_address.city_name no puede superar 100 caracteres.',
  })
  city_name?: string;

  /** Código DANE de departamento, 2 dígitos (`cbc:CountrySubentityCode`). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}$/, {
    message:
      'customer_address.department_code debe ser el código DANE de departamento de 2 dígitos (ej. "05" = Antioquia). Son los dos primeros dígitos del city_code.',
  })
  department_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, {
    message: 'customer_address.department_name no puede superar 100 caracteres.',
  })
  department_name?: string;

  /**
   * ISO 3166-1 alfa-2. Por defecto `CO`: la facturación electrónica que emite
   * Vendix es colombiana, y un adquiriente sin país declarado es colombiano
   * salvo prueba en contrario (para el resto está `export_invoice`).
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message:
      'customer_address.country_code debe ser el código ISO 3166-1 alfa-2 en mayúsculas (ej. "CO", "US"). No uses el nombre del país ni el código de 3 letras.',
  })
  country_code?: string = 'CO';

  @IsOptional()
  @IsString()
  @MaxLength(20, {
    message: 'customer_address.postal_code no puede superar 20 caracteres.',
  })
  postal_code?: string;
}

/**
 * Eleva una dirección enviada como STRING plano a `InvoiceAddressDto`.
 *
 * POR QUÉ existe: el formulario de creación de factura del panel declara
 * `customer_address: ['']` — un `FormControl` de texto — y serializa un string.
 * Tipar el campo a objeto sin más solo cambiaría un 400 por otro 400, que es
 * exactamente el defecto que esta fase viene a cerrar. Y un string suelto no es
 * un error del usuario: es una dirección sin desglosar, perfectamente utilizable
 * en `cbc:AddressLine` aunque no traiga códigos DANE.
 *
 * Antes de esto el string ni siquiera llegaba al XML: `normalizeAddress()`
 * devuelve `undefined` para todo lo que no sea `typeof === 'object'`, así que la
 * dirección tecleada se perdía en silencio entre la columna `Json` y el UBL.
 *
 * Es idempotente a propósito: `class-transformer` puede correr `@Transform`
 * antes o después de `@Type` según la forma del valor, y esta función devuelve
 * lo mismo en ambos órdenes.
 */
export function liftInvoiceAddress(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Un control de texto vacío no es "dirección inválida", es "sin dirección".
    if (trimmed === '') return undefined;
    return plainToInstance(InvoiceAddressDto, { address_line: trimmed });
  }

  if (value instanceof InvoiceAddressDto) return value;

  if (typeof value === 'object' && !Array.isArray(value)) {
    return plainToInstance(InvoiceAddressDto, value as Record<string, unknown>);
  }

  // Números, booleanos, arreglos: se devuelven crudos para que `@ValidateNested`
  // los delate en vez de que esta función los enmascare.
  return value;
}
