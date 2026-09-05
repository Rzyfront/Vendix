import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AIU_BUCKETS } from '../invoice-profile-config.contract';

/**
 * Cota del número de líneas de una factura de MUESTRA.
 *
 * No es la cota de una factura real —ésa la fija `CreateInvoiceDto`—: es la de un
 * ejemplo que existe para que alguien mire un XML en pantalla. Un contrato AIU
 * tiene cuatro conceptos (A, I, U y costo reembolsable); 40 líneas ya permiten
 * ilustrar un contrato con costos desglosados y siguen produciendo un documento
 * legible. Sin cota, una petición con 100.000 líneas convierte un endpoint de
 * lectura en un generador de XML de cientos de megas.
 */
export const PREVIEW_MAX_LINES = 40;

/**
 * Una línea de la factura de muestra.
 *
 * ## Por qué la línea declara `bucket` y no `aiu_component`
 *
 * `aiu_component` admite tres valores y el NULL significa «costo reembolsable»,
 * un cuarto caso legítimo que no es la ausencia de dato. En una muestra escrita a
 * mano ese NULL es indistinguible de un olvido, y confundirlos cambia la base
 * gravable: el costo no grava nunca, mientras que un componente sin declarar
 * bajo `et_462_1` sí. `AiuBucket` hace explícitos los cuatro casos —el mismo
 * vocabulario que usa la matriz de impuestos del perfil— y el servicio traduce
 * `'costo'` a `aiu_component: null` en un único sitio.
 */
export class PreviewProfileLineDto {
  @IsIn(AIU_BUCKETS, {
    message: `bucket debe ser uno de: ${AIU_BUCKETS.join(', ')}. Usa «costo» para la porción de costo reembolsable del contrato, que no hace parte del AIU.`,
  })
  bucket: string;

  @IsOptional()
  @IsString({ message: 'La descripción de la línea debe ser texto.' })
  @MaxLength(500, {
    message: 'La descripción de la línea no puede superar 500 caracteres.',
  })
  description?: string;

  /**
   * Misma cota que `CreateInvoiceItemDto.quantity` y por la misma razón: la
   * columna es `Decimal(12,4)`, así que `0.0001` es lo mínimo representable. Un
   * `0` produce una línea con base cero que el XML declara y nadie cobra.
   */
  @IsOptional()
  @IsNumber({}, { message: 'La cantidad debe ser un número.' })
  @Type(() => Number)
  @Min(0.0001, {
    message:
      'La cantidad debe ser mayor que cero (mínimo 0.0001). Para no facturar un concepto, quita la línea en vez de ponerla en cero.',
  })
  quantity?: number;

  @IsNumber({}, { message: 'El valor de la línea debe ser un número.' })
  @Type(() => Number)
  @Min(0, {
    message:
      'El valor de la línea no puede ser negativo. Para descontar usa discount_amount; una línea negativa no existe en el perfil de la DIAN.',
  })
  unit_price: number;

  @IsOptional()
  @IsNumber({}, { message: 'El descuento de la línea debe ser un número.' })
  @Type(() => Number)
  @Min(0, { message: 'El descuento de la línea no puede ser negativo.' })
  discount_amount?: number;

  /**
   * Código UN/ECE rec. 20 de la unidad (`cbc:InvoicedQuantity/@unitCode`).
   *
   * No se valida contra `DIAN_UNIT_CODES` en el DTO: el servicio lo comprueba y
   * lo reporta como una VALIDACIÓN del resultado, no como un 400. La diferencia
   * importa — el propósito de la previsualización es enseñar qué rechazaría la
   * DIAN, así que un código de unidad inventado tiene que llegar al informe en
   * vez de morir en la puerta sin explicación.
   */
  @IsOptional()
  @IsString({ message: 'unit_code debe ser texto.' })
  @MaxLength(10, { message: 'unit_code admite hasta 10 caracteres.' })
  unit_code?: string;
}

/**
 * Adquiriente de la muestra. **Todo opcional a propósito.**
 *
 * Una previsualización no debe exigir un cliente: el operador está configurando
 * un perfil, no facturando. Ausente ⇒ el servicio usa un adquiriente de muestra
 * MARCADO como tal (ver `PREVIEW_CUSTOMER`), nunca un tercero real ni un NIT
 * plausible.
 */
export class PreviewCustomerDto {
  @IsOptional()
  @IsString({ message: 'document_type debe ser texto.' })
  @MaxLength(10, { message: 'document_type admite hasta 10 caracteres.' })
  document_type?: string;

  @IsOptional()
  @IsString({ message: 'document_number debe ser texto.' })
  @MaxLength(30, { message: 'document_number admite hasta 30 caracteres.' })
  document_number?: string;

  @IsOptional()
  @IsString({ message: 'legal_name debe ser texto.' })
  @MaxLength(300, { message: 'legal_name admite hasta 300 caracteres.' })
  legal_name?: string;
}

/**
 * Factura de MUESTRA con la que se previsualiza un perfil (FB-12, ADR-5).
 *
 * ## Los dos modos, y por qué existen los dos
 *
 * · **Derivado** — se manda `contract_value` (y opcionalmente `aiu_value`) y el
 *   servicio compone las líneas desde `model_lines` y el reparto `aiu.components`
 *   del perfil. Es el modo del editor: el operador acaba de escribir la matriz de
 *   tarifas y quiere ver qué produce, sin inventarse una factura.
 * · **Explícito** — se manda `lines[]`. Es el modo de la verificación: permite
 *   construir a mano los cuatro escenarios AIU del plan (régimen × omisión ×
 *   contradicción) y comprobar que el XML declara lo que debe.
 *
 * Los dos modos son excluyentes y el servicio lo hace cumplir: mezclarlos dejaría
 * ambiguo si el `contract_value` manda sobre la suma de las líneas o al revés, y
 * la respuesta a esa pregunta cambia la base gravable.
 *
 * ## Lo que este DTO NO acepta, a propósito
 *
 * No hay `invoice_number`, ni `resolution_id`, ni `cufe`. La previsualización no
 * numera (ERR-11) ni firma: aceptar esos campos daría a entender que el XML
 * proyectado es transmisible, y su parecido con un documento real es exactamente
 * el riesgo que ADR-5 acota.
 */
export class PreviewProfileDto {
  /**
   * Valor total del contrato de la muestra, en pesos. Sólo del modo derivado.
   */
  @IsOptional()
  @IsNumber({}, { message: 'contract_value debe ser un número.' })
  @Type(() => Number)
  @Min(1, {
    message:
      'contract_value debe ser mayor que cero: un contrato de valor cero no produce ninguna base gravable que previsualizar.',
  })
  contract_value?: number;

  /**
   * Porción del contrato que es AIU. Sólo del modo derivado.
   *
   * Ausente ⇒ el servicio usa el piso legal del perfil
   * (`aiu.minimum_base_percent` sobre `contract_value`), que es la muestra más
   * conservadora posible y además hace visible el piso. Ver
   * `derivePreviewLines`.
   */
  @IsOptional()
  @IsNumber({}, { message: 'aiu_value debe ser un número.' })
  @Type(() => Number)
  @Min(0, { message: 'aiu_value no puede ser negativo.' })
  aiu_value?: number;

  /**
   * Objeto del contrato de la muestra. Pisa el del perfil, igual que la factura
   * real pisa el de la configuración de la tienda.
   *
   * La longitud NO se valida acá: el límite real es el del `cbc:Note` completo
   * —prefijo incluido— y lo comprueba el servicio contra
   * `DIAN_AIU_NOTE_MIN_LENGTH`/`MAX_LENGTH`, reportándolo como validación CAV03.
   * Un `@MaxLength` acá mediría el fragmento equivocado.
   */
  @IsOptional()
  @IsString({ message: 'contract_object debe ser texto.' })
  @MaxLength(5000, {
    message: 'contract_object admite hasta 5000 caracteres.',
  })
  contract_object?: string;

  /**
   * Fecha de emisión de la muestra, `YYYY-MM-DD`. Ausente ⇒ hoy.
   *
   * Se acepta para que la verificación pueda fijarla y comparar XML entre
   * corridas: sin ella, dos previsualizaciones del mismo perfil difieren en
   * `cbc:IssueDate` y no se pueden contrastar byte a byte.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'issue_date debe tener el formato YYYY-MM-DD.',
  })
  issue_date?: string;

  @IsOptional()
  @IsArray({ message: 'lines debe ser un arreglo de líneas.' })
  @ArrayMinSize(1, {
    message: 'Si mandas lines, necesita al menos una línea.',
  })
  @ArrayMaxSize(PREVIEW_MAX_LINES, {
    message: `Una factura de muestra admite hasta ${PREVIEW_MAX_LINES} líneas.`,
  })
  @ValidateNested({ each: true })
  @Type(() => PreviewProfileLineDto)
  lines?: PreviewProfileLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PreviewCustomerDto)
  customer?: PreviewCustomerDto;

  /**
   * Pide la representación gráfica del documento además del XML.
   *
   * Ausente o `false` ⇒ la respuesta es byte a byte la de siempre (sin clave
   * `html`): el flag no puede cambiar el contrato existente. En `true`, la
   * respuesta gana `html: string | null` —el papel compuesto con los datos
   * capturados, o `null` si no se pudo componer— sin escribir nada en base
   * ni tomar consecutivo.
   */
  @IsOptional()
  @IsBoolean({ message: 'include_render debe ser un booleano.' })
  include_render?: boolean;
}
