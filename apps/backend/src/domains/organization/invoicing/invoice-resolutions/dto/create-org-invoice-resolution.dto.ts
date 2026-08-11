import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateResolutionDto } from '../../../../store/invoicing/resolutions/dto/create-resolution.dto';

/**
 * Alta de una resolución / rango de numeración DIAN por el carril de
 * ORGANIZACIÓN.
 *
 * Hereda de `CreateResolutionDto` a propósito: la FORMA del payload (tipos,
 * cotas, longitudes, `document_type` restringido a los tipos que sí numeran
 * contra resolución) es la misma regla DIAN venga por el panel de la tienda, por
 * la consola de super admin o por aquí. Heredar en vez de re-declarar es lo que
 * impide que un carril acepte lo que otro rechaza.
 *
 * Las reglas que cruzan campos —qué exige cada tipo de documento, rango
 * coherente, vigencia coherente, inmutabilidad de la identidad fiscal— viven en
 * `OrgInvoiceResolutionsService`, que las consume del mismo contrato
 * (`fiscal-document-requirements.ts`) y responde con los mismos códigos de error
 * que `ResolutionsService`.
 *
 * ## Prohibido añadir inicializadores de propiedad
 *
 * `UpdateOrgInvoiceResolutionDto` hace `PartialType(CreateOrgInvoiceResolutionDto)`,
 * y `@nestjs/mapped-types` copia los **inicializadores de propiedad** del DTO base
 * (`inheritPropertyInitializers`). Un `campo = valor` aquí se materializaría en
 * TODO PATCH que no mandara ese campo, y el servicio —que decide con
 * `!== undefined`— lo escribiría como si el usuario lo hubiera pedido. Es
 * exactamente el defecto que reactivaba en silencio resoluciones retiradas. Los
 * defectos van en el servicio (`?? true`), nunca aquí.
 */
export class CreateOrgInvoiceResolutionDto extends CreateResolutionDto {
  /**
   * Tienda a la que pertenece la resolución. **Opcional a propósito**, y ésta es
   * la diferencia real con el carril de tienda: una organización con
   * `fiscal_scope=ORGANIZATION` factura bajo un solo NIT consolidado y su
   * resolución no cuelga de ninguna tienda (`store_id = null`). Sólo cuando
   * `fiscal_scope=STORE` el servicio lo exige, y entonces valida además que la
   * tienda pertenezca a la organización del contexto.
   *
   * No convertir esto en obligatorio: importaría la suposición del carril de
   * tienda y rompería el modelo multi-tienda.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_id?: number;
}
