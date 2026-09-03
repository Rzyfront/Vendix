import { IsIn, IsOptional } from 'class-validator';

/**
 * A QUÉ CATÁLOGO DE LA DIAN se le pregunta por los rangos autorizados.
 *
 * ── POR QUÉ EL AMBIENTE VIAJA EN LA PETICIÓN ───────────────────────────────
 *
 * Porque heredarlo de `config.environment` producía un ciclo cerrado. Una
 * configuración en habilitación preguntaba a `vpfe-hab.dian.gov.co`, donde las
 * autorizaciones de PRODUCCIÓN no viven; la lista volvía vacía; sin rango no
 * había cómo crear la fila de `invoice_resolutions`; sin esa fila el readiness
 * respondía `FISCAL_RESOLUTION_MISSING`; sin readiness la promoción a producción
 * se negaba; y sin producción la consulta seguía apuntando a habilitación.
 *
 * La única salida era el rodeo que sufrió la configuración 20 (NIT 1123408049):
 * inventar una resolución falsa, promover con ella, consultar los rangos reales,
 * borrar la falsa y activar la verdadera. Entre la promoción y el borrado la
 * configuración estaba en producción con una ClTec inventada, y cada factura
 * emitida en esa ventana se habría firmado con ella — `FAD06`, y el consecutivo
 * autorizado que gastó no se recupera. Un parámetro de consulta cuesta menos.
 *
 * ── POR QUÉ NO HACE FALTA UN ESTADO INTERMEDIO ─────────────────────────────
 *
 * Porque lo que decide si un documento electrónico puede salir NO es este
 * parámetro sino `InvoiceEmissionGateService.assertElectronicEmissionLive`, que
 * exige `environment === 'production' && enablement_status === 'enabled'` sobre
 * la CONFIGURACIÓN. Consultar el catálogo de producción desde una configuración
 * en habilitación no mueve ninguna de esas dos columnas: la operación lee, no
 * emite, no reserva consecutivo y no promueve nada.
 *
 * ── AUSENTE NO ES INVÁLIDO ─────────────────────────────────────────────────
 *
 * `@IsOptional()` para que omitirlo signifique «el de la configuración» —el
 * comportamiento anterior, intacto para todo llamador que no sepa del
 * parámetro—. Y `@IsIn` sin más tolerancia: cualquier otro valor se rechaza con
 * 400 antes de gastar la consulta SOAP, porque un ambiente que no se entiende no
 * tiene un default sensato — «probablemente quiso decir producción» es
 * exactamente la clase de suposición que este archivo existe para no hacer.
 */
export class QueryNumberingRangeDto {
  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: 'test' | 'production';
}
