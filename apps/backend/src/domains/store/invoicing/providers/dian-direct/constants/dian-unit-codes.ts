/**
 * Unidades de medida — `@unitCode` de `cbc:InvoicedQuantity`,
 * `cbc:CreditedQuantity`, `cbc:DebitedQuantity`, `cbc:BaseQuantity` y
 * `cbc:BaseUnitMeasure`.
 *
 * FUENTE
 * ------
 * - `Caja_de_herramientas.../Listas de valores/UnidadesMedida-2.1.gc`
 *   (1089 códigos únicos). Es la UN/ECE Recommendation 20 adoptada por la DIAN.
 * - Anexo Técnico 1.9 §13.2.8.6 «Unidades de Cantidad: @unitCode», que remite la
 *   tabla 13.3.6 a `Anexo Tecnico/Tablas Referenciadas`.
 * - Schematron `DIAN_UBL21-listacodigos_v1.6.sch`, regla FB04, con exactamente
 *   los mismos códigos.
 *
 * SEVERIDAD: es NOTIFICACIÓN, no rechazo. La regla FB04 del Schematron está
 * marcada `flag="warning"`, y el anexo 1.9 describe FBB05 como «Notificación: si
 * el valor…». O sea: una unidad fuera de lista NO quema el consecutivo. Pero sí
 * declara mal la operación: una línea de 3 metros enviada como `EA` le dice a la
 * DIAN «3 unidades», no «3 metros».
 *
 * =====================================================================
 * AVISO GRAVE: LA LISTA OFICIAL ESTÁ CORROMPIDA POR TRADUCCIÓN AUTOMÁTICA
 * =====================================================================
 * La DIAN publicó la lista UN/ECE traducida al español con una herramienta
 * automática que tradujo también los CÓDIGOS de dos letras que coinciden con
 * palabras inglesas. La corrupción está en el `.gc` Y en el Schematron, es
 * decir: es lo que el validador realmente compara. Casos verificados:
 *
 *   UN/ECE real → lo que la DIAN publica
 *     `AS`  (unidad de montaje)     → `SON` y `COMO`
 *     `AY`  (montaje)               → `SÍ`
 *     `HE`  (centésima de quilate)  → `ÉL`
 *     `ON`  (onza)                  → `EN`
 *     `MON` (mes)                   → `LUN`
 *     `ANN` (año)                   → `ANA`
 *     `BE`  (haz)                   → `SER`
 *     `NMI` (milla náutica)         → `MNI`
 *     `SCO` (cuenta)                → `OCS`
 *     `STI` (stone)                 → `ITS`
 *     `SW`  (metro cuadrado)        → `SO`
 *     `GK`  (…por kilogramo)        → `G K`  ← ¡con espacio!
 *     `PI`  (pitch)                 → `Pi`
 *     `1A`, `2A`, `4A`, `5A`        → `1ª`, `2ª`, `4ª`, `5ª`
 *     `4O`                          → `4º`
 *
 * Consecuencia práctica: para que la DIAN NO notifique hay que enviar el código
 * CORROMPIDO, no el correcto de UN/ECE. Por eso el catálogo curado de abajo
 * evita deliberadamente toda esa zona: solo usa códigos de 3 letras sin
 * homógrafo en inglés, que la traducción no tocó. Si algún día se necesita
 * facturar por mes o por año, el código a enviar es `LUN` / `ANA` — y esta nota
 * explica por qué eso no es una errata de quien lo escriba.
 *
 * =====================================================================
 * DEFECTO DETECTADO FUERA DE ESTE ARCHIVO (no se corrige aquí)
 * =====================================================================
 * `apps/backend/src/domains/store/products/services/uom-uncefact.util.ts` mapea
 * `km → 'KMT'`. **`KMT` NO EXISTE** en la lista de la DIAN: el kilómetro es
 * `KTM`. (`KMT` tampoco existe en UN/ECE rec 20; parece una transposición de
 * `KTM`.) Toda línea facturada en kilómetros sale hoy con una unidad
 * desconocida. La corrección es de un carácter, pero ese archivo está fuera del
 * alcance de este catálogo: usar `DIAN_UNIT_CODES.KILOMETER` desde allí.
 */

/**
 * Unidades que un comercio colombiano usa de verdad, todas verificadas una por
 * una contra `UnidadesMedida-2.1.gc`.
 *
 * Criterio de inclusión: (a) que aparezca en la lista de la DIAN, y (b) que no
 * caiga en la zona corrompida por la traducción descrita arriba.
 */
export const DIAN_UNIT_CODES = {
  // ---- Conteo ----------------------------------------------------------
  /** `EA` «cada» — la unidad por defecto y el respaldo histórico de Vendix. */
  EACH: 'EA',
  /** `94` «unidad». Sinónimo válido de `EA`; se prefiere `EA` por costumbre. */
  UNIT: '94',
  /** `C62` «uno». Tercer sinónimo de la lista. */
  ONE: 'C62',
  /** `PR` «par». */
  PAIR: 'PR',
  /** `DZN` «docena». */
  DOZEN: 'DZN',
  /** `CEN` «cien». */
  HUNDRED: 'CEN',
  /** `MIL` «mil». */
  THOUSAND: 'MIL',
  /** `SET` «conjunto» — juegos y kits. */
  SET: 'SET',
  /** `NAR` «número de artículos». */
  NUMBER_OF_ARTICLES: 'NAR',
  /** `NMP` «número de paquetes». */
  NUMBER_OF_PACKS: 'NMP',

  // ---- Masa ------------------------------------------------------------
  /** `MGM` «miligramo». */
  MILLIGRAM: 'MGM',
  /** `GRM` «gramo». */
  GRAM: 'GRM',
  /** `KGM` «kilogramo». */
  KILOGRAM: 'KGM',
  /** `LBR` «libra». */
  POUND: 'LBR',
  /** `ONZ` «onza» (de masa). */
  OUNCE: 'ONZ',
  /** `TNE` «tonelada (tonelada métrica)». */
  TONNE: 'TNE',

  // ---- Volumen ---------------------------------------------------------
  /** `MLT` «mililitro». */
  MILLILITRE: 'MLT',
  /** `LTR` «litro». */
  LITRE: 'LTR',
  /** `GLL` «galón» (US). */
  GALLON: 'GLL',
  /** `OZA` «onza líquida (US)». */
  FLUID_OUNCE: 'OZA',
  /** `MTQ` «metro cúbico». */
  CUBIC_METRE: 'MTQ',

  // ---- Longitud --------------------------------------------------------
  /** `MMT` «milímetro». */
  MILLIMETRE: 'MMT',
  /** `CMT` «centímetro». */
  CENTIMETRE: 'CMT',
  /** `MTR` «metro». */
  METRE: 'MTR',
  /** `KTM` «kilómetro». NO es `KMT`, que no existe — ver el aviso de arriba. */
  KILOMETRE: 'KTM',
  /** `INH` «pulgada». */
  INCH: 'INH',
  /** `FOT` «pie». */
  FOOT: 'FOT',
  /** `YRD` «yarda». */
  YARD: 'YRD',

  // ---- Superficie ------------------------------------------------------
  /** `MTK` «metro cuadrado». */
  SQUARE_METRE: 'MTK',
  /** `FTK` «pie cuadrado». */
  SQUARE_FOOT: 'FTK',

  // ---- Empaque ---------------------------------------------------------
  /** `BX` «caja». */
  BOX: 'BX',
  /** `CT` «caja de cartón». */
  CARTON: 'CT',
  /** `PK` «paquete». */
  PACK: 'PK',
  /** `BG` «bolso» — bolsa/costal pequeño. */
  BAG: 'BG',
  /** `SA` «saco» — el bulto de 25/50 kg del agro y la ferretería. */
  SACK: 'SA',
  /** `BO` «botella». */
  BOTTLE: 'BO',
  /** `JR` «tarro». */
  JAR: 'JR',
  /** `TU` «tubo». */
  TUBE: 'TU',
  /** `RL` «carrete» — rollos de cable, cinta, tela. */
  REEL: 'RL',
  /** `ST` «hoja» — láminas, pliegos. */
  SHEET: 'ST',
  /** `PU` «bandeja / paquete de bandeja». */
  TRAY: 'PU',

  // ---- Tiempo y servicios ---------------------------------------------
  /** `MIN` «minuto». */
  MINUTE: 'MIN',
  /** `HUR` «hora» — la unidad natural de un servicio facturado por tiempo. */
  HOUR: 'HUR',
  /** `DAY` «día». */
  DAY: 'DAY',

  // ---- Energía ---------------------------------------------------------
  /** `KWH` «kilovatios hora». */
  KILOWATT_HOUR: 'KWH',

  /** `ZZ` «mutuamente definido» — comodín acordado entre las partes. */
  MUTUALLY_DEFINED: 'ZZ',
} as const;

/** Unión de las unidades curadas. */
export type DianUnitCode = (typeof DIAN_UNIT_CODES)[keyof typeof DIAN_UNIT_CODES];

/** Unidad por defecto cuando no hay equivalencia: «cada». */
export const DIAN_DEFAULT_UNIT_CODE: DianUnitCode = DIAN_UNIT_CODES.EACH;

/**
 * Los 1089 códigos de `UnidadesMedida-2.1.gc`, separados por `|`, para poder
 * validar sin enumerarlos con nombre.
 *
 * Se guarda como cadena (3825 B) y se convierte a `Set` una sola vez, por la
 * misma razón que en `dian-geography.ts`: para `tsc` es un solo token, mientras
 * que un arreglo literal de 1089 strings es 1089 nodos que typechequear.
 *
 * Incluye los códigos corrompidos por la traducción (`SÍ`, `ÉL`, `1ª`, `G K`…)
 * porque son los que el validador de la DIAN realmente acepta — incluido `G K`,
 * que lleva un espacio dentro del propio código y es la razón de que el
 * delimitador sea `|` y no el espacio. Reproducir la
 * lista oficial es el objetivo; corregirla la haría inservible para validar.
 */
const DIAN_UNIT_CODES_RAW =
  '04|05|08|10|11|13|14|15|16|17|18|19|1B|1C|1D|1E|1F|1G|1H|1I|1J|1K|1L|1M|1X|1ª|20|21|22|23|24|25|26|27|28|29|2B|2C|2I|2J|2K|2L|2M|2N|2P|2Q|2R|2U|2V|2W|2X|2Y|2Z|2ª|30|31|32|33|34|35|36|37|38|3B|3C|3E|3G|3H|3I|40|41|43|44|45|46|47|48|4B|4C|4E|4G|4H|4K|4L|4M|4N|4P|4Q|4R|4T|4U|4W|4X|4ª|4º|53|54|56|57|58|59|5B|5C|5E|5F|5G|5H|5I|5J|5K|5P|5Q|5ª|60|61|62|63|64|66|69|71|72|73|74|76|77|78|80|81|84|85|87|89|90|91|92|93|94|95|96|97|98|A1|A10|A11|A12|A13|A14|A15|A16|A17|A18|A19|A2|A20|A21|A22|A23|A24|A25|A26|A27|A28|A29|A3|A30|A31|A32|A33|A34|A35|A36|A37|A38|A39|A4|A40|A41|A42|A43|A44|A45|A47|A48|A49|A5|A50|A51|A52|A53|A54|A55|A56|A57|A58|A6|A60|A61|A62|A63|A64|A65|A66|A67|A68|A69|A7|A70|A71|A73|A74|A75|A76|A77|A78|A79|A8|A80|A81|A82|A83|A84|A85|A86|A87|A88|A89|A9|A90|A91|A93|A94|A95|A96|A97|A98|AA|AB|ACR|AD|AE|AH|AI|AJ|AK|AL|AM|AMH|AMP|ANA|AP|APZ|AQ|AR|ASM|ASU|ATM|ATT|AV|AW|AZ|B0|B1|B11|B12|B13|B14|B' +
  '15|B16|B18|B2|B20|B21|B22|B23|B24|B25|B26|B27|B28|B29|B3|B31|B32|B33|B34|B35|B36|B37|B38|B39|B4|B40|B41|B42|B43|B44|B45|B46|B47|B48|B49|B5|B50|B51|B52|B53|B54|B55|B56|B57|B58|B59|B6|B60|B61|B62|B63|B64|B65|B66|B67|B69|B7|B70|B71|B72|B73|B74|B75|B76|B77|B78|B79|B8|B81|B83|B84|B85|B86|B87|B88|B89|B9|B90|B91|B92|B93|B94|B95|B96|B97|B98|B99|BAR|BB|BD|BFT|BG|BH|BHP|BIL|BJ|BK|BL|BLD|BLL|BO|BP|BQL|BR|BT|BTU|BUA|BUI|BW|BX|BZ|C0|C1|C10|C11|C12|C13|C14|C15|C16|C17|C18|C19|C2|C20|C22|C23|C24|C25|C26|C27|C28|C29|C3|C30|C31|C32|C33|C34|C35|C36|C38|C39|C4|C40|C41|C42|C43|C44|C45|C46|C47|C48|C49|C5|C50|C51|C52|C53|C54|C55|C56|C57|C58|C59|C6|C60|C61|C62|C63|C64|C65|C66|C67|C68|C69|C7|C70|C71|C72|C73|C75|C76|C77|C78|C8|C80|C81|C82|C83|C84|C85|C86|C87|C88|C89|C9|C90|C91|C92|C93|C94|C95|C96|C97|C98|C99|CA|CCT|CDL|CE|CEL|CEN|CG|CGM|CH|CJ|CK|CKG|CL|CLF|CLT|CMK|CMQ|CMT|CNP|CNT|CO|COMO|COU|CQ|CR|CS|CT|CTM|CU|C' +
  'UR|CV|CWA|CWI|CY|CZ|D1|D10|D12|D13|D14|D15|D16|D17|D18|D19|D2|D20|D21|D22|D23|D24|D25|D26|D27|D28|D29|D30|D31|D32|D33|D34|D35|D37|D38|D39|D40|D41|D42|D43|D44|D45|D46|D47|D48|D49|D5|D50|D51|D52|D53|D54|D55|D56|D57|D58|D59|D6|D60|D61|D62|D63|D64|D65|D66|D67|D69|D7|D70|D71|D72|D73|D74|D75|D76|D77|D79|D8|D80|D81|D82|D83|D85|D86|D87|D88|D89|D9|D90|D91|D92|D93|D94|D95|D96|D97|D98|D99|DAA|DAD|DAY|DB|DC|DD|DE|DEC|DG|DI|DJ|DLT|DMK|DMQ|DMT|DN|DPC|DPR|DPT|DQ|DR|DRA|DRI|DRL|DRM|DS|DT|DTN|DU|DWT|DX|DY|DZN|DZP|E2|E3|E4|E5|EA|EB|EN|EP|EQ|EV|F1|F9|FAH|FAR|FB|FC|FD|FE|FF|FG|FH|FL|FM|FOT|FP|FR|FS|FTK|FTQ|G K|G2|G3|G7|GB|GBQ|GC|GD|GE|GF|GFI|GGR|GH|GIA|GII|GJ|GL|GLD|GLI|GLL|GM|GN|GO|GP|GQ|GRM|GRN|GRO|GRT|GT|GV|GW|GWH|GY|GZ|H1|H2|HA|HAR|HBA|HBX|HC|HD|HF|HGM|HH|HI|HIU|HJ|HK|HL|HLT|HM|HMQ|HMT|HN|HO|HP|HPA|HS|HT|HTZ|HUR|HY|IA|IC|IE|IF|II|IL|IM|INH|INK|INQ|IP|IT|ITS|IU|IV|J2|JB|JE|JG|JK|JM|JO|JOU|JR|K1|K2|K3|K5|' +
  'K6|KA|KB|KBA|KD|KEL|KF|KG|KGM|KGS|KHZ|KI|KJ|KJO|KL|KMH|KMK|KMQ|KNI|KNS|KNT|KO|KPA|KPH|KPO|KPP|KR|KS|KSD|KSH|KT|KTM|KTN|KUR|KVA|KVR|KVT|KW|KWH|KWT|KX|L2|LA|LBR|LBT|LC|LD|LE|LEF|LF|LH|LI|LJ|LK|LM|LN|LO|LP|LPA|LR|LS|LTN|LTR|LUM|LUN|LUX|LX|LY|M0|M1|M4|M5|M7|M9|MA|MAL|MAM|MAW|MBE|MBF|MBR|MC|MCU|MD|MF|MGM|MIK|MIL|MIN|MIO|MIU|MK|MLD|MLT|MMK|MMQ|MMT|MNI|MPA|MQ|MQH|MQS|MSK|MT|MTK|MTQ|MTR|MTS|MV|MVA|MWH|N1|N2|N3|NA|NAR|NB|NBB|NC|NCL|ND|NE|NEW|NF|NG|NH|NI|NIU|NJ|NL|NMP|NN|NPL|NPR|NQ|NR|NRL|NT|NTT|NU|NV|NX|NY|OA|OCS|OHM|ONZ|OP|OT|OZA|OZI|P0|P1|P2|P3|P4|P5|P6|P7|P8|P9|PA|PAL|PB|PD|PE|PF|PG|PGL|PK|PL|PM|PN|PO|PQ|PR|PT|PTD|PTI|PTL|PU|PV|PW|PY|PZ|Pi|Q3|QA|QAN|QB|QD|QH|QK|QR|QT|QTD|QTI|QTL|QTR|R1|R4|R9|RA|RD|RG|RH|RK|RL|RM|RN|RO|RP|RPM|RPS|RS|RT|RU|S3|S4|S5|S6|S7|S8|SA|SAN|SCR|SD|SE|SEC|SER|SET|SG|SHT|SIE|SK|SL|SMI|SN|SO|SON|SP|SQ|SR|SS|SST|ST|STN|SV|SX|SÍ|T0|T1|T3|T4|T5|T6|T7|T8|TA|TAH|TC|TD|TE|TF|TI|TJ' +
  '|TK|TL|TN|TNE|TNP|TP|TPR|TQ|TQD|TR|TRL|TS|TSD|TSH|TT|TU|TV|TW|TY|U1|U2|UA|UB|UC|UD|UE|UF|UH|UM|VA|VI|VLT|VQ|VS|W2|W4|WA|WB|WCD|WE|WEB|WEE|WG|WH|WHR|WI|WM|WR|WSD|WTT|WW|X1|YDK|YDQ|YL|YRD|YT|Z1|Z2|Z3|Z4|Z5|Z6|Z8|ZP|ZZ|ÉL';

let unit_code_set: ReadonlySet<string> | null = null;

/** `true` si el código pertenece a la lista de unidades de medida de la DIAN. */
export function isDianUnitCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!unit_code_set) unit_code_set = new Set(DIAN_UNIT_CODES_RAW.split('|'));
  return unit_code_set.has(value);
}

/**
 * Devuelve el código si pertenece a la lista de la DIAN; si no, `EA`.
 *
 * Es la red de seguridad para unidades que vengan de datos del comerciante: una
 * unidad desconocida nunca debe impedir emitir la factura, pero tampoco debe
 * viajar sin verificar hasta el XML.
 */
export function toDianUnitCode(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && isDianUnitCode(trimmed)
    ? trimmed
    : DIAN_DEFAULT_UNIT_CODE;
}
