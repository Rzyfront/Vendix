import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { TrimString } from '../../../../../common/decorators/trim-string.decorator';

/**
 * UN rango de los que la DIAN reporta, señalado para traerlo a
 * `invoice_resolutions`.
 *
 * ── POR QUÉ SÓLO VIAJA UN SELECTOR Y NO EL RANGO ENTERO ────────────────────
 *
 * Porque el servicio CONSULTA a la DIAN y toma los valores de allí. Aceptar el
 * rango completo del cliente convertiría la ClTec —la clave con la que se firma
 * el CUFE de cada factura del rango— en un campo que cualquiera con
 * `invoicing:write` puede dictar, y una clave dictada es indistinguible de la
 * autorizada hasta que la DIAN rechaza el primer documento con `FAD06` y su
 * consecutivo autorizado se pierde.
 *
 * ── LOS DOS CAMPOS SON UNA SOLA IDENTIDAD ─────────────────────────────────
 *
 * Se exigen JUNTOS: un mismo prefijo puede aparecer en dos autorizaciones
 * sucesivas y un número de resolución sin prefijo no dice sobre qué serie
 * escribir; el par es lo único que identifica el rango sin ambigüedad. Si la
 * DIAN devolviera dos rangos con el mismo par, el servicio se detiene en vez de
 * escoger uno.
 *
 * ── POR QUÉ AQUÍ SÍ SON OBLIGATORIOS ──────────────────────────────────────
 *
 * En la versión de un solo rango se declaraban `@IsOptional()` para que el
 * cuerpo incompleto se rechazara con el mensaje del servicio —que explica POR
 * QUÉ hacen falta los dos— en vez de con el «should not be empty» genérico. En
 * lote esa concesión se vuelve en contra: un elemento sin prefijo tumbaría con
 * su mensaje una llamada donde los otros 20 elementos estaban perfectos. Un
 * cuerpo mal formado es un fallo del LOTE ENTERO y se rechaza aquí, antes de
 * gastar la consulta SOAP; el servicio conserva la misma exigencia como defensa
 * en profundidad para los llamadores internos que arman el DTO a mano y no
 * pasan por este `ValidationPipe`.
 */
export class ApplyNumberingRangeItemDto {
  /** Número de la Autorización de Numeración, tal como lo reporta la DIAN. */
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  resolution_number: string;

  /** Prefijo de la serie, tal como lo reporta la DIAN. */
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  prefix: string;
}

/**
 * Los rangos que hay que sincronizar en esta llamada.
 *
 * ── POR QUÉ LOTE Y NO UNA LLAMADA POR RANGO ───────────────────────────────
 *
 * Porque el dato que decide la escritura —qué rangos tiene AUTORIZADOS este NIT
 * y con qué ClTec cada uno— sale de una sola respuesta de `GetNumberingRange`.
 * Aplicar rango por rango obligaba a repetir esa consulta SOAP una vez por
 * rango para responder una pregunta que ya tenía respuesta, y contra un
 * servicio que se cae, se demora y a veces devuelve `InvalidSecurity`: cada
 * repetición era otra oportunidad de que la mitad del trabajo quedara a medias
 * sin que nadie supiera cuál mitad.
 *
 * ── EL TOPE ───────────────────────────────────────────────────────────────
 *
 * 50 y no 100 como el resto de las operaciones masivas: aquí el lote no lo
 * arma un archivo sino un puñado de casillas sobre los rangos que la DIAN
 * reporta para UN software, que en la práctica son unidades. 50 deja margen de
 * sobra y acota el trabajo por petición.
 */
export class ApplyNumberingRangesDto {
  /**
   * A QUÉ CATÁLOGO DE LA DIAN se le piden los valores que se van a escribir.
   *
   * Misma validación y mismo default que en `QueryNumberingRangeDto`, y por la
   * misma razón: la aplicación vuelve a consultar `GetNumberingRange` para tomar
   * de ahí la ClTec, así que si la consulta puede mirar el catálogo de
   * producción y la aplicación no, lo que se ve queda fuera del alcance de lo
   * que se puede traer — que es el ciclo cerrado que este parámetro rompe.
   *
   * NO habilita nada. La fila queda escrita en `invoice_resolutions`, pero
   * `InvoiceEmissionGateService.assertElectronicEmissionLive` sigue exigiendo
   * `environment === 'production' && enablement_status === 'enabled'` sobre la
   * CONFIGURACIÓN para cualquier emisión electrónica: una resolución de
   * producción aplicada mientras la configuración sigue en `test` está escrita y
   * es inconsumible. Por eso este cambio no necesita un estado intermedio.
   *
   * Ausente ⇒ el de la configuración, igual que antes.
   */
  @IsOptional()
  @IsIn(['test', 'production'])
  environment?: 'test' | 'production';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ApplyNumberingRangeItemDto)
  ranges: ApplyNumberingRangeItemDto[];
}
