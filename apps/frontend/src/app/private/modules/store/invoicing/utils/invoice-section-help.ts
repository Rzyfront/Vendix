/**
 * Ayuda larga de cada sección de la captura fiscal, en UN solo lugar.
 *
 * ## Por qué es una constante y no texto en la plantilla
 *
 * Las mismas secciones existen dos veces: en «Nueva factura», donde se llenan
 * por documento, y en el editor de perfiles, donde se preconfiguran. Si cada
 * plantilla trajera su propio texto, la explicación de qué es una base gravable
 * AIU acabaría dicha de dos maneras distintas —y una de las dos, tarde o
 * temprano, contradiciendo a la norma que la otra cita.
 *
 * Cada entrada trae dos variantes cuando la sección significa cosas distintas
 * según dónde se lea: `invoice` (esta factura) y `profile` (el valor por
 * omisión). Cuando el texto sirve igual en las dos, hay una sola cadena.
 *
 * ## Por qué el texto lleva saltos de línea reales
 *
 * El panel de ayuda los respeta (`whitespace-pre-line`). Un párrafo por idea
 * hace que se pueda ojear; un muro de texto se salta entero, y estas
 * explicaciones son justamente las que evitan una factura mal emitida.
 */

/** Ayuda de una sección: única, o distinta según la pantalla. */
export interface SectionHelp {
  invoice: string;
  profile: string;
}

const help = (invoice: string, profile?: string): SectionHelp => ({
  invoice,
  profile: profile ?? invoice,
});

export const INVOICE_SECTION_HELP = {
  documento: help(
    `Los datos de cabecera del documento: qué se emite, con qué numeración autorizada, cuándo, y cómo se paga.

La RESOLUCIÓN decide el prefijo y el consecutivo que gasta esta factura. Cada número que se toma de un rango autorizado se consume aunque la DIAN rechace el documento, así que elegir mal aquí no se deshace con un borrado.

La FORMA DE PAGO (contado o crédito) y el MEDIO DE PAGO (efectivo, transferencia, tarjeta…) son dos códigos distintos del anexo técnico y viajan separados. La forma decide si hay vencimiento; el medio sólo describe con qué se pagó.

Las NOTAS de cabecera viajan al XML como «cbc:Note» y las ve el adquiriente. Lo que no debe salir del negocio va en Notas internas.`,
    `Lo que traerá precargada cada factura de este perfil: resolución preferida, forma y medio de pago, plazo y notas de cabecera.

La RESOLUCIÓN PREFERIDA es una preferencia, no una orden: la emisión la usa sólo si ese rango puede numerar el día de la factura —activo, vigente, con consecutivo y de producción—. Si no puede, se elige la vigente más antigua y la pantalla dice por qué. Un perfil se configura una vez y se usa durante meses: la numeración vence, se agota y se reemplaza.

El PLAZO en días sólo se aplica cuando la forma de pago es a crédito; en contado la factura vence el mismo día de la emisión.

Todo lo de aquí se puede cambiar factura por factura. El perfil es el punto de partida, no un candado.`,
  ),

  adquiriente: help(
    `El comprador, tal como lo exige la DIAN.

El TIPO y el NÚMERO de identificación tienen que coincidir con el RUT. Un NIT con dígito de verificación equivocado hace que la DIAN rechace el documento, y el consecutivo que gastó no vuelve.

El CORREO es la dirección a la que se entrega la factura electrónica: no es un dato de contacto, es parte de la entrega legal.

Las RESPONSABILIDADES FISCALES salen del RUT del comprador y deciden, entre otras cosas, si hay que practicar retención. Marcarlas de memoria es la forma más común de dejar de retener a un agente retenedor.`,
  ),

  lineas: help(
    `Lo que se vende, línea por línea.

Cada línea lleva su propio grupo de impuestos: lo que se marque acá es lo que emite «cac:TaxTotal» en el XML. Una línea sin impuesto declara una operación excluida o exenta — no es «IVA al 0 %», y por eso no se rechaza por declarar una tarifa que no existe.

El PRECIO UNITARIO admite hasta seis decimales porque el anexo lo permite para el precio, aunque los totales se declaren con dos.`,
    `Las líneas con las que NACERÁ la factura al elegir este perfil.

Sirven para el contrato que se factura igual todos los meses: en vez de teclear las mismas cuatro líneas, se eligen una vez acá. En la factura se pueden editar, añadir y borrar — son un punto de partida, no un candado.

Las cantidades y los precios se dejan en blanco a propósito si cambian cada mes: lo que ahorra tiempo es tener la descripción, la unidad y —en un documento AIU— el componente al que pertenece cada línea.`,
  ),

  impuestos: help(
    `Los impuestos que se declaran, y sobre qué base.

Lo que aquí se marque gravable es lo que emite «cac:TaxTotal»; lo que no, no emite totalización alguna. La diferencia importa: declarar una tarifa del 0 % no es lo mismo que no declarar el tributo, y la DIAN rechaza lo primero cuando la operación es excluida.

El impuesto de cabecera es la SUMA de los impuestos de línea, cada uno con dos decimales. No es la tarifa aplicada al total — calcularlo así produce diferencias de céntimos que la validación de totales rechaza.`,
    `La matriz que decide qué impuesto grava qué porción, y con qué tarifa, en todas las facturas de este perfil.

Existe para repartir el importe entre porciones gravables y no gravables. En una venta ordinaria no hace falta: el impuesto lo declara cada línea desde el catálogo de tarifas del producto.

Las tarifas se guardan; las bases no. La base es el importe de cada factura concreta.`,
  ),

  aiu: help(
    `Administración, Imprevistos y Utilidad: el desglose que exige la DIAN cuando el IVA no se calcula sobre el valor total del contrato.

El RÉGIMEN decide qué entra a la base gravable, y los dos que existen son incompatibles: bajo el art. 462-1 del E.T. (aseo, vigilancia, servicios temporales) el IVA se calcula sobre A+I+U completo, con un piso del 10 % del valor del contrato; bajo el Decreto 1372/1992 (construcción de bien inmueble) sólo grava la Utilidad.

Elegir el régimen equivocado no da error: produce una factura que declara de menos o de más, y sólo se corrige con nota crédito.

El OBJETO DEL CONTRATO es obligatorio para emitir: sin él el documento se rechaza antes de tomar consecutivo.`,
    `La configuración AIU por omisión de este perfil, en cuatro bloques que se preconfiguran una vez y se aplican después a las líneas de cada factura.

MODELO DE CONTABILIZACIÓN — si el AIU son líneas del documento (y el contrato es su suma) o si es sólo base de impuestos sobre una línea única.

CUENTAS — la cuenta del PUC contra la que se reconoce el ingreso de cada componente. Vacío = el mapeo contable de la tienda.

BASE AIU — el reparto en porcentajes, y la unidad sobre la que se miden. Los mismos tres números significan cosas distintas si se miden sobre el valor del contrato o sobre el AIU: revísala antes que los números.

BASE IMPUESTOS — qué impuesto grava qué componente y con qué tarifa.`,
  ),

  retenciones: help(
    `Lo que el comprador retiene y no paga: retefuente, reteIVA, reteICA.

La retención NO reduce el total que se declara a la DIAN —«PayableAmount» se valida sin mirarla—: reduce lo que efectivamente se cobra. Viaja como un único importe positivo, nunca como un impuesto negativo.

Se calcula por concepto (tarifa sobre una base) o se escribe a mano el importe total. Lo segundo existe para el caso en que el comprador informa una retención que no cuadra con ningún concepto configurado.`,
    `Los conceptos de retención que se precargarán en cada factura de este perfil.

Sirve para el cliente que retiene siempre lo mismo: se elige el concepto, el lado de la operación y la tarifa una sola vez, y cada factura nace con esas filas listas.

La BASE no se guarda: es el importe de cada factura concreta y se calcula al emitir. Lo que el perfil aporta es el concepto y la tarifa, que es lo que se olvida.`,
  ),

  divisa: help(
    `La conversión a moneda extranjera, cuando hay que declararla.

La factura se emite SIEMPRE en pesos colombianos. La divisa extranjera sólo declara la conversión («cac:PaymentAlternativeExchangeRate») y no cambia el importe legal: el valor exigible sigue siendo el total en COP. Res. DIAN 000042/2020, art. 73.

La TASA es la del día de la operación. Se consulta la TRM oficial, y si se teclea a mano queda dicho de dónde salió: una tasa puesta a ojo que parezca verificada es peor que una tasa en blanco.`,
    `Si las facturas de este perfil declaran conversión a una divisa extranjera, y a cuál.

Se guarda la divisa, no la tasa: la tasa es del día de cada factura y se consulta al emitir. Guardar una tasa aquí sería declarar el cambio de la fecha en que alguien configuró el perfil.`,
  ),

  contabilidad: help(
    `Contra qué cuentas del PUC se reconoce esta factura.

Vacío = se usa el mapeo contable de la tienda, que es lo normal. Sobrescribir una cuenta aquí es para el caso en que este documento concreto se lleva a una cuenta distinta de la habitual.

El asiento se genera al emitir. Una cuenta que no exista en el PUC de la tienda deja el asiento sin registrar, y la factura sale igual: el descuadre aparece después, al cerrar.`,
    `Las cuentas del PUC por omisión de este perfil.

Vacío = el mapeo contable de la tienda. Poner una cuenta aquí sirve cuando este tipo de operación se reconoce en una cuenta distinta de la que usa el resto del negocio — un ingreso por servicios frente a uno por mercancía, por ejemplo.

En un documento AIU las cuentas de Administración, Imprevistos y Utilidad no se configuran acá: viven en el bloque «Cuentas para contabilización AIU», junto al régimen que las gobierna.`,
  ),

  formato: help(
    `El diseño con el que se imprime o se envía el PDF.

No cambia nada de lo que viaja a la DIAN: el XML es el mismo. Lo que cambia es lo que ve el cliente.`,
    `La plantilla de impresión con la que saldrán las facturas de este perfil, y cuántos decimales se muestran.

El formato NO altera el XML: la DIAN recibe siempre los mismos importes con dos decimales. Los decimales de aquí son sólo de presentación — mostrar tres en el papel de un documento que declara dos es lo que hace que el cliente sume distinto que la factura.

Si la plantilla elegida se borra después, la factura sale con el formato de la tienda y no se rompe nada.`,
  ),

  notas_internas: help(
    `Notas que NO viajan al XML y no las ve el cliente.

Es el lugar para el número de contrato interno, el nombre de quien autorizó, o el motivo de una tarifa distinta de la habitual. Lo que el adquiriente debe leer va en las notas de cabecera del documento.`,
  ),

  previsualizacion: help(
    `Cómo quedaría un documento emitido con esta configuración, sin emitir nada.

No toma consecutivo, no consulta resolución y no llega a la DIAN: el número que muestra es un marcador. Sirve para ver el reparto del AIU, las bases gravables y los totales antes de comprometer numeración autorizada.`,
  ),

  historial: help(
    `Cada guardado crea una versión nueva y la anterior queda intacta.

Las versiones son inmutables a propósito: una factura emitida en marzo se armó con la configuración de marzo, y poder leerla es lo que hace auditable el documento. Cambiar el perfil hoy no reescribe nada de lo ya emitido.`,
  ),
} as const satisfies Record<string, SectionHelp>;

/** Clave de sección con ayuda registrada. */
export type InvoiceSectionKey = keyof typeof INVOICE_SECTION_HELP;

/** La ayuda tal como se lee en «Nueva factura». */
export function invoiceHelp(key: InvoiceSectionKey): string {
  return INVOICE_SECTION_HELP[key].invoice;
}

/** La ayuda tal como se lee en el editor de perfiles. */
export function profileHelp(key: InvoiceSectionKey): string {
  return INVOICE_SECTION_HELP[key].profile;
}
