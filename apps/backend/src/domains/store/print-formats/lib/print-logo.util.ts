import { Logger } from '@nestjs/common';
import { S3Service } from '../../../../common/services/s3.service';

/**
 * Firma best-effort la key de S3 del logo de una tienda antes de exponerla al
 * compositor de impresión (`print-layout-composer.service.ts`).
 *
 * `stores.logo_url` guarda la KEY DESNUDA de S3 — correcto, es lo que exige
 * `vendix-s3-storage`: nunca se persiste una URL firmada porque expira. El
 * compositor vuelca ese valor directo en un `<img src="...">`; sin firmar
 * antes, el navegador recibe una ruta relativa de S3, el `<img>` da 404 y
 * pinta el `alt="Logo"` literal en el ticket/factura — el defecto que
 * reportó el dueño en todos los papeles.
 *
 * Best-effort a propósito: el logo es cosmético. Si S3 falla (latencia,
 * permisos, key corrupta) se devuelve `undefined` — el compositor cae al
 * logo mono por defecto — en vez de reventar el render completo de un
 * documento por un logo. Mismo criterio que
 * `fiscal-invoice-pdf-render.service.ts` usa con `downloadImage`.
 *
 * `s3Service` puede venir `undefined`: los specs de los proveedores que usan
 * este helper los instancian a mano con menos argumentos que en runtime
 * (donde Nest siempre inyecta `S3Service` porque `print-formats.module.ts`
 * importa `S3Module`). Sin `s3Service` se devuelve la key cruda tal cual
 * llegó — mismo comportamiento que tenían los proveedores antes de este fix.
 */
export async function signStoreLogoUrl(
  s3Service: S3Service | undefined,
  logoKey: string | null | undefined,
  logger?: Logger,
): Promise<string | undefined> {
  if (!logoKey || !s3Service) {
    return logoKey ?? undefined;
  }
  try {
    return await s3Service.signUrl(logoKey);
  } catch (e) {
    logger?.warn(`No se pudo firmar el logo de la tienda para impresión: ${(e as Error)?.message}`);
    return undefined;
  }
}
