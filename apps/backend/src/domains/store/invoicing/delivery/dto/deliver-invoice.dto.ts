import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Deliberadamente SIN `@IsEmail()`. Si el formato se validara acá, el
 * `ValidationPipe` global (`transform:true, whitelist:true,
 * forbidNonWhitelisted:true`) respondería 400 `SYS_VALIDATION_001` antes de que
 * la petición llegara al servicio — pero el contrato de E.6 (ERR-06) exige un
 * 422 de dominio con `error_code: INVOICING_DELIVERY_001`. La validación de
 * formato vive en `InvoiceDeliveryService` con `isEmail()` de `class-validator`
 * en modo standalone, para poder lanzar `VendixHttpException` con el código
 * propio en vez del genérico que produce el pipe.
 */
export class DeliverInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  email: string;
}
