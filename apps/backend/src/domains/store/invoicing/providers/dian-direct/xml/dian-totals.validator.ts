import { DOMParser } from '@xmldom/xmldom';
import { toDecimal } from '../../../utils/dian-money.util';
import {
  DIAN_RULES,
  type DianRuleKey,
  type DianUblRootDocument,
} from '../../../fiscal-document-requirements';

/**
 * Comprueba sobre el XML YA ARMADO las reglas de totalización que la DIAN
 * evalúa por XPath y que ningún validador previo podía ver.
 *
 * POR QUÉ NO VIVE EN `FiscalDocumentValidator`
 * --------------------------------------------
 * Ese validador juzga la ENTRADA y recomputa los importes «con las MISMAS
 * funciones que los escriben» —lo dice su propio comentario, y es lo correcto:
 * si recomputara con aritmética propia aprobaría documentos que el emisor
 * escribe distinto—. La consecuencia es que un defecto COMPARTIDO con el emisor
 * le resulta invisible por construcción: el 17/08/2026 el generador declaró
 * `TaxExclusiveAmount = 69900.00` sobre un documento cuyas líneas no aportaban
 * base, el validador recomputó lo mismo, y ambos coincidieron en el error.
 *
 * POR QUÉ NO VIVE EN `UblStructureValidator`
 * ------------------------------------------
 * Ese valida el modelo de contenido de los XSD, y en UBL `cac:TaxSubtotal` es
 * legítimamente `min: 0` dentro de `TaxTotalType`. Endurecerlo allí sería
 * falsear el esquema: la restricción no es de UBL, es de la DIAN. Y ese archivo
 * declara explícitamente que sólo comprueba «qué hijos, en qué orden, cuántas
 * veces», no aritmética.
 *
 * Así que las reglas de negocio sobre el XML emitido necesitan su propia
 * compuerta, y esta es. Corre en el mismo punto obligado que la estructural
 * (`signXml`, antes de firmar), donde abortar todavía no cuesta el consecutivo.
 *
 * LAS CINCO REGLAS
 * ----------------
 *
 * Las cuatro de totales (`AU02`, `AU04`, `AU06`, `AU14`) forman una CADENA: cada
 * una juzga un eslabón distinto de la misma aritmética, y por eso ninguna
 * sustituye a otra. Con las cuatro puestas, el único XML que pasa es el que
 * cuadra en los cuatro puntos donde la DIAN mira.
 *
 * · **FAS01b / CAS01b / DAS01b** — ningún `cac:TaxTotal` sin `cac:TaxSubtotal`.
 *
 *   ⚠️ SOBRE LA CITA. La versión anterior de este comentario atribuía a FAS01b
 *   la frase «se presenta cuando una factura no tiene impuestos pero aparece el
 *   nodo `<cac:TaxTotal>`». Esa frase NO ESTÁ en el Anexo 1.9 (comprobado por
 *   búsqueda literal sobre la extracción completa del PDF). Lo que la fila
 *   FAS01b dice (anexo19.txt:21971, pág. 428) es otra cosa: «Valida que existe
 *   solo un grupo con información de totales para un mismo tributo en la factura
 *   y que los impuestos IVA (01), INC (04) deben existir también en al menos una
 *   línea de la factura». Se conserva la cita porque un grupo de cabecera sin
 *   subtotales incumple justamente esa correspondencia cabecera↔línea, pero el
 *   rechazo ARITMÉTICO por el mismo defecto lo nombra **FAS02** —«Valor total de
 *   un tributo no corresponde a la suma de toda la información correspondiente a
 *   cada una de las tarifas informadas», que es `sum(TaxTotal/TaxSubtotal/
 *   cbc:TaxAmount)` contra `TaxTotal/cbc:TaxAmount`— y por eso el mensaje de la
 *   violación nombra las dos.
 *
 *   Un EXCLUIDO (art. 476 ET) no está sujeto al impuesto: no informa el grupo,
 *   ni en la línea ni en la cabecera. Un EXENTO (art. 477 ET) sí está gravado,
 *   a tarifa cero: informa `cac:TaxSubtotal` con `cbc:Percent` en `0.00`. Por
 *   eso la señal no es «el importe es cero» sino «el grupo no trae subtotales».
 *
 * · **FAU02 / CAU02 / DAU02** (anexo19.txt:22411) —
 *   `round(<grupo>/cbc:LineExtensionAmount) == round(sum(<raíz>/<línea>/cbc:LineExtensionAmount))`.
 *   El bruto de la cabecera es la suma de los brutos de las líneas. Es la única
 *   de las cuatro que NO mira tributos: mide si la cabecera y el detalle hablan
 *   del mismo documento.
 *
 * · **FAU04 / CAU04 / DAU04** (anexo19.txt:22432) —
 *   `round(//cbc:TaxExclusiveAmount) == round(sum(<línea>/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount))`.
 *   La cabecera sólo puede declarar como base imponible lo que sus líneas
 *   declaran como base. Una línea que omite su grupo de tributos no aporta
 *   ninguna, así que no puede sumar en la cabecera.
 *
 *   FAU02 y FAU04 MIDEN COSAS DISTINTAS y su divergencia es legítima: el bruto
 *   de una línea puede ser mayor que su base gravable. Ahí vive el régimen AIU
 *   —la línea vale el contrato, pero sólo la porción gravable declara base— y
 *   por eso ninguna de las dos puede deducirse de la otra.
 *
 * · **FAU06 / CAU06 / DAU06** (anexo19.txt:22475, fórmula completa en 13015) —
 *   `round(<grupo>/cbc:LineExtensionAmount + sum(//cac:TaxTotal[not(ancestor::<línea>)]/cbc:TaxAmount))
 *    == round(//cbc:TaxInclusiveAmount)`.
 *
 *   ⚠️ LA PROSA Y LA FÓRMULA NO DICEN LO MISMO. La columna «Regla» habla de «la
 *   Suma de los Tributos de todas las líneas de detalle», pero el predicado que
 *   la DIAN ejecuta suma los `cac:TaxTotal` que **NO** están bajo una línea, es
 *   decir los de CABECERA. Programar la prosa —sumar los tributos de las
 *   líneas— da el mismo número sólo mientras cabecera y detalle coincidan, y
 *   deja de darlo exactamente en el documento donde importa. Se implementa la
 *   fórmula.
 *
 *   `cac:WithholdingTaxTotal` queda fuera por su nombre, que es lo correcto: la
 *   retención no suma al valor bruto más tributos.
 *
 * · **FAU14 / CAU14 / DAU14** (anexo19.txt:22621, fórmula completa en 8869) —
 *   `round(//cbc:TaxInclusiveAmount − //cbc:AllowanceTotalAmount + //cbc:ChargeTotalAmount)
 *    == round(<grupo>/cbc:PayableAmount)`, y cada operando ausente vale `0.00`
 *   (el anexo lo envuelve en `if (boolean(...))`).
 *
 *   ⚠️ EL ANTICIPO NO SE RESTA. El anexo LIGA `$PrepaidAmount :=
 *   sum(//cac:PrepaidPayment/cbc:PaidAmount)` y luego **no lo usa** en
 *   `$PayableAmount := $TaxInclusiveAmount - $SumTotalAllowance +
 *   $SumTotalCharge`. La prosa de CAU14 sí dice «– valor anticipos». Quien
 *   programe la prosa y descuente el anticipo del valor a pagar se lleva un
 *   rechazo FAU14 por un documento aritméticamente razonable. Se implementa la
 *   fórmula, no la descripción.
 *
 *   FAU14 lee el `cbc:TaxInclusiveAmount` **declarado**, no el que FAU06
 *   recomputa: así un `TaxInclusiveAmount` mal escrito produce UNA violación
 *   (FAU06) y no dos, y el hallazgo apunta al eslabón que falló.
 *
 * Se implementan sobre el DOM y no con la aritmética del emisor a propósito: el
 * valor de esta compuerta está en LEER lo que se va a transmitir, no en
 * recalcularlo por segunda vez desde la misma fuente.
 *
 * Los identificadores NO se concatenan a partir de la letra de familia: se
 * resuelven contra `DIAN_RULES`, el catálogo transcrito del anexo, de modo que
 * un identificador que el anexo no publique no pueda salir en un hallazgo.
 *
 * Los nodos se recorren como `any`, igual que en `ubl-structure.validator.ts`:
 * el DOM de `@xmldom/xmldom` no es estructuralmente el `Element` de `lib.dom`.
 */

/** Namespace → prefijo canónico. Mismo criterio que el validador estructural. */
const NAMESPACE_PREFIXES: Readonly<Record<string, string>> = {
  'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2':
    'cac',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2': 'cbc',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2':
    'ext',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2':
    'sig',
  'dian:gov:co:facturaelectronica:Structures-2-1': 'sts',
};

/**
 * Raíz → letra con la que el anexo nombra sus reglas, y elemento de línea.
 *
 * `ApplicationResponse` y `AttachedDocument` NO están: no llevan totales
 * monetarios ni líneas, así que no hay nada que estas reglas puedan juzgar.
 * Documento soporte y documento equivalente comparten raíz `Invoice`, y sus
 * reglas homólogas (`DSAS01b`, etc.) validan lo mismo con otro identificador;
 * se cita la familia `F` porque es la que el emisor produce con ese elemento
 * raíz, y el mensaje explica el defecto sin depender de la cita.
 */
interface DocumentFamily {
  letter: string;
  line_element: string;
  /**
   * NOMBRE DEL GRUPO DE TOTALES, QUE NO ES EL MISMO PARA LOS TRES.
   *
   * UBL 2.1 llama `cac:RequestedMonetaryTotal` al de la nota débito; los demás
   * usan `cac:LegalMonetaryTotal`. No son sinónimos: la DIAN publica un XPath
   * distinto por documento y las tres reglas de totales resuelven a través de
   * él, así que leer el grupo equivocado hace que el validador no encuentre
   * nada y apruebe por ausencia —el peor de los fallos posibles en una
   * compuerta—.
   */
  monetary_total: 'LegalMonetaryTotal' | 'RequestedMonetaryTotal';
}

const DOCUMENT_FAMILIES: Readonly<Record<string, DocumentFamily>> = {
  Invoice: {
    letter: 'F',
    line_element: 'cac:InvoiceLine',
    monetary_total: 'LegalMonetaryTotal',
  },
  CreditNote: {
    letter: 'C',
    line_element: 'cac:CreditNoteLine',
    monetary_total: 'LegalMonetaryTotal',
  },
  DebitNote: {
    letter: 'D',
    line_element: 'cac:DebitNoteLine',
    monetary_total: 'RequestedMonetaryTotal',
  },
};

export type DianTotalsViolationKind =
  | 'tax-total-without-subtotal'
  | 'line-extension-total-mismatch'
  | 'tax-exclusive-base-mismatch'
  | 'tax-inclusive-total-mismatch'
  | 'payable-amount-mismatch'
  | 'malformed';

export interface DianTotalsViolation {
  /** Identificador de la regla del Anexo Técnico, p. ej. `FAS01b`. */
  rule: string;
  kind: DianTotalsViolationKind;
  /** Ruta al elemento, estilo XPath simplificado: `Invoice/cac:TaxTotal[2]`. */
  path: string;
  /** Mensaje en español, listo para `details` de una excepción tipada. */
  message: string;
  details?: Record<string, unknown>;
}

export interface DianTotalsResult {
  valid: boolean;
  violations: DianTotalsViolation[];
  /**
   * Raíz reconocida, o `null` si el documento no lleva totales que juzgar.
   * Distingue «no aplicaba» de «se comprobó y pasó», igual que hace el
   * validador estructural con su propio `root`.
   */
  root: string | null;
}

export class DianTotalsValidator {
  /**
   * @param xml XML completo SIN FIRMAR. Se parsea aquí; el llamador no necesita
   *   mantener un DOM vivo.
   */
  static validate(xml: string): DianTotalsResult {
    const parse_errors: string[] = [];
    const parser = new DOMParser({
      errorHandler: (level: string, message: any) => {
        if (level === 'error' || level === 'fatalError') {
          parse_errors.push(String(message));
        }
      },
    });

    let doc: any;
    try {
      doc = parser.parseFromString(xml, 'text/xml');
    } catch (error) {
      parse_errors.push(error instanceof Error ? error.message : String(error));
    }

    if (parse_errors.length > 0 || !doc?.documentElement) {
      return {
        valid: false,
        root: null,
        violations: [
          {
            rule: '—',
            kind: 'malformed',
            path: '/',
            message: `El XML generado no está bien formado: ${
              parse_errors[0] ?? 'no tiene elemento raíz'
            }`,
          },
        ],
      };
    }

    const root: any = doc.documentElement;
    const root_name: string = root.localName || root.nodeName;
    const family = DOCUMENT_FAMILIES[root_name];

    // Sin totales monetarios ni líneas no hay nada que estas dos reglas puedan
    // decir. `root: null` lo declara: no es que haya pasado, es que no aplicaba.
    if (!family) return { valid: true, root: null, violations: [] };

    const violations: DianTotalsViolation[] = [];
    // En orden ascendente de identificador, que es el orden en que el anexo las
    // publica y el orden en que un lector coteja el rechazo contra el gate.
    this.checkTaxTotalsHaveSubtotals(root, root_name, family.letter, violations);
    this.checkLineExtensionTotal(root, root_name, family, violations);
    this.checkTaxExclusiveBase(root, root_name, family, violations);
    this.checkTaxInclusiveTotal(root, root_name, family, violations);
    this.checkPayableAmount(root, root_name, family, violations);

    return { valid: violations.length === 0, violations, root: root_name };
  }

  // ---------------------------------------------------------------------------
  // FAS01b — ningún `cac:TaxTotal` sin `cac:TaxSubtotal`
  // ---------------------------------------------------------------------------

  /**
   * Recorre TODO el documento, no sólo la cabecera: el grupo de tributos existe
   * también dentro de cada línea, y el mismo defecto —crear el elemento antes
   * del bucle que lo llena— produce ahí el mismo rechazo.
   *
   * `cac:WithholdingTaxTotal` queda fuera por su propio nombre, que es lo
   * correcto: la retención se totaliza sin subtotales y la DIAN no la juzga con
   * esta regla.
   */
  private static checkTaxTotalsHaveSubtotals(
    root: any,
    root_name: string,
    letter: string,
    violations: DianTotalsViolation[],
  ): void {
    const rule = `${letter}AS01b`;
    let seen = 0;

    this.walkAll(root, root_name, (node, qname, path) => {
      if (qname !== 'cac:TaxTotal') return;
      seen += 1;

      const subtotals = this.childrenNamed(node, 'cac:TaxSubtotal');
      if (subtotals.length > 0) return;

      const tax_amount = this.textOfChild(node, 'cbc:TaxAmount');

      violations.push({
        rule,
        kind: 'tax-total-without-subtotal',
        path,
        message:
          `El grupo \`cac:TaxTotal\` declara ${tax_amount ?? 'un total'} sin ` +
          `ningún \`cac:TaxSubtotal\` que lo respalde. La DIAN recompone la base ` +
          `gravable desde los subtotales, no encuentra ninguno, y rechaza el ` +
          `documento (${rule}; el descuadre aritmético del mismo defecto lo ` +
          `nombra ${letter}AS02). Un ítem EXCLUIDO no informa el grupo de tributos; ` +
          `si la operación es EXENTA, el grupo debe llevar su subtotal con ` +
          `\`cbc:Percent\` en 0.00.`,
        details: { tax_amount, tax_total_index: seen },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // FAU04 — la base de cabecera es la que declaran las líneas
  // ---------------------------------------------------------------------------

  private static checkTaxExclusiveBase(
    root: any,
    root_name: string,
    family: DocumentFamily,
    violations: DianTotalsViolation[],
  ): void {
    const rule = this.ruleId('header_tax_exclusive', root_name);
    if (!rule) return;

    // `//cbc:TaxExclusiveAmount` en XPath 1.0 se convierte a número por su PRIMER
    // nodo en orden de documento. Se replica esa semántica en vez de sumar todas
    // las apariciones, para juzgar el mismo valor que juzga la DIAN.
    const declared_node = this.findFirst(root, 'cbc:TaxExclusiveAmount');
    if (!declared_node) return; // documento sin grupo de totales monetarios

    const declared_text = this.textOf(declared_node);
    const declared = toDecimal(declared_text);

    let base = toDecimal(0);
    for (const line of this.childrenNamed(root, family.line_element)) {
      for (const tax_total of this.childrenNamed(line, 'cac:TaxTotal')) {
        for (const subtotal of this.childrenNamed(tax_total, 'cac:TaxSubtotal')) {
          const taxable = this.textOfChild(subtotal, 'cbc:TaxableAmount');
          if (taxable !== null) base = base.plus(toDecimal(taxable));
        }
      }
    }

    // La regla compara con `round()`, es decir a peso entero. Comparar con más
    // precisión inventaría rechazos que la DIAN no produce: el truncado hoja por
    // hoja puede separar dos representaciones del mismo importe en centavos.
    const declared_rounded = declared.toDecimalPlaces(0).toString();
    const base_rounded = base.toDecimalPlaces(0).toString();
    if (declared_rounded === base_rounded) return;

    violations.push({
      rule,
      kind: 'tax-exclusive-base-mismatch',
      path: `${root_name}/…/cbc:TaxExclusiveAmount`,
      message:
        `La cabecera declara una base imponible de ${declared_text}, pero las ` +
        `líneas que informan tributo suman ${base.toFixed(2)}. La regla ${rule} ` +
        `compara \`cbc:TaxExclusiveAmount\` contra ` +
        `\`sum(${family.line_element}/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount)\` ` +
        `y rechaza la diferencia. Una línea que omite su grupo de tributos no ` +
        `aporta base gravable, así que no puede sumar en la cabecera.`,
      details: {
        declared: declared_text,
        line_taxable_base: base.toFixed(2),
        difference: declared.minus(base).toFixed(2),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // FAU02 — el bruto de la cabecera es la Σ de los brutos de las líneas
  // ---------------------------------------------------------------------------

  /**
   * `round(<grupo>/cbc:LineExtensionAmount)` contra
   * `round(sum(<raíz>/<línea>/cbc:LineExtensionAmount))`.
   *
   * Es la comprobación más simple de las cuatro y la que atrapa el descuadre más
   * grosero: cabecera y detalle describiendo documentos distintos. El emisor la
   * cumple «por construcción» porque escribe los dos lados con la misma función
   * (`dianLineExtensionTotal`), y esa es exactamente la razón por la que hace
   * falta comprobarla sobre el DOM: un defecto compartido con el emisor es
   * invisible a cualquier validador que recompute con sus mismas funciones.
   *
   * Una línea SIN `cbc:LineExtensionAmount` no aporta nada, que es la semántica
   * de `sum()` en XPath sobre un node-set vacío. No se inventa su importe.
   */
  private static checkLineExtensionTotal(
    root: any,
    root_name: string,
    family: DocumentFamily,
    violations: DianTotalsViolation[],
  ): void {
    const rule = this.ruleId('header_line_extension', root_name);
    if (!rule) return;

    const group = this.monetaryTotalGroup(root, family);
    if (!group) return; // documento sin grupo de totales monetarios

    const declared_text = this.textOfChild(group, 'cbc:LineExtensionAmount');
    if (declared_text === null) return; // nada declarado que juzgar

    const declared = toDecimal(declared_text);

    let lines = 0;
    let sum = toDecimal(0);
    for (const line of this.childrenNamed(root, family.line_element)) {
      lines += 1;
      const amount = this.textOfChild(line, 'cbc:LineExtensionAmount');
      if (amount !== null) sum = sum.plus(toDecimal(amount));
    }

    if (this.pesos(declared) === this.pesos(sum)) return;

    violations.push({
      rule,
      kind: 'line-extension-total-mismatch',
      path: `${root_name}/cac:${family.monetary_total}/cbc:LineExtensionAmount`,
      message:
        `La cabecera declara un valor bruto antes de tributos de ` +
        `${declared_text}, pero sus ${lines} línea(s) suman ${sum.toFixed(2)}. ` +
        `La regla ${rule} compara ` +
        `\`${family.monetary_total}/cbc:LineExtensionAmount\` contra ` +
        `\`sum(${family.line_element}/cbc:LineExtensionAmount)\` y rechaza la ` +
        `diferencia. Cabecera y detalle tienen que describir el MISMO documento.`,
      details: {
        declared: declared_text,
        line_sum: sum.toFixed(2),
        difference: declared.minus(sum).toFixed(2),
        lines,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // FAU06 — bruto + tributos DE CABECERA
  // ---------------------------------------------------------------------------

  /**
   * `round(<grupo>/cbc:LineExtensionAmount + sum(//cac:TaxTotal[not(ancestor::<línea>)]/cbc:TaxAmount))`
   * contra `round(//cbc:TaxInclusiveAmount)`.
   *
   * Los tributos que suman son los de CABECERA, no los de las líneas: ver el
   * aviso sobre prosa-vs-fórmula en la cabecera del archivo. Y se toman los
   * `cbc:TaxAmount` HIJOS DIRECTOS del grupo: el `cbc:TaxAmount` que vive dentro
   * de un `cac:TaxSubtotal` está un nivel más abajo y contarlo duplicaría el
   * impuesto.
   *
   * `//cbc:TaxInclusiveAmount` se resuelve por su PRIMER nodo en orden de
   * documento, que es la semántica de la conversión a número en XPath 1.0 y la
   * misma que ya aplica `checkTaxExclusiveBase`.
   *
   * ES LA REGLA QUE EL MODELO DE CONTABILIZACIÓN AIU ALTERA. Con el AIU sumado
   * al total, la línea vale el contrato y sólo una porción declara base: el
   * bruto crece sin que crezca el tributo, y esta identidad es la que dice si el
   * documento sigue cuadrando. Era la menos cubierta del código —una sola
   * mención, en un comentario— antes de esta compuerta.
   */
  private static checkTaxInclusiveTotal(
    root: any,
    root_name: string,
    family: DocumentFamily,
    violations: DianTotalsViolation[],
  ): void {
    const rule = this.ruleId('header_tax_inclusive', root_name);
    if (!rule) return;

    const group = this.monetaryTotalGroup(root, family);
    if (!group) return;

    const declared_node = this.findFirst(root, 'cbc:TaxInclusiveAmount');
    if (!declared_node) return;

    const declared_text = this.textOf(declared_node);
    const declared = toDecimal(declared_text);

    // Ausente ⇒ 0.00. Un grupo de totales sin bruto es un defecto de otra regla
    // (`AU01`, grupo incompleto); tratarlo como cero deja que ESTA hable en vez
    // de callar, que es lo que haría abortar aquí.
    const line_extension_text = this.textOfChild(
      group,
      'cbc:LineExtensionAmount',
    );
    const line_extension = toDecimal(line_extension_text ?? 0);
    const header_taxes = this.sumHeaderTaxAmounts(root, family.line_element);
    const expected = line_extension.plus(header_taxes);

    if (this.pesos(declared) === this.pesos(expected)) return;

    violations.push({
      rule,
      kind: 'tax-inclusive-total-mismatch',
      path: `${root_name}/cac:${family.monetary_total}/cbc:TaxInclusiveAmount`,
      message:
        `La cabecera declara un valor bruto más tributos de ${declared_text}, ` +
        `pero su bruto (${line_extension.toFixed(2)}) más los tributos de ` +
        `cabecera (${header_taxes.toFixed(2)}) suman ${expected.toFixed(2)}. ` +
        `La regla ${rule} evalúa ` +
        `\`${family.monetary_total}/cbc:LineExtensionAmount + ` +
        `sum(//cac:TaxTotal[not(ancestor::${family.line_element})]/cbc:TaxAmount)\` ` +
        `y rechaza la diferencia. OJO: suma los tributos de CABECERA, no los de ` +
        `las líneas, aunque la columna «Regla» del anexo diga lo contrario.`,
      details: {
        declared: declared_text,
        line_extension: line_extension.toFixed(2),
        header_tax_amount: header_taxes.toFixed(2),
        expected: expected.toFixed(2),
        difference: declared.minus(expected).toFixed(2),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // FAU14 — el valor a pagar
  // ---------------------------------------------------------------------------

  /**
   * `round(//cbc:TaxInclusiveAmount − //cbc:AllowanceTotalAmount + //cbc:ChargeTotalAmount)`
   * contra `round(<grupo>/cbc:PayableAmount)`, con cada operando ausente en
   * `0.00` porque el anexo lo envuelve en `if (boolean(...))`.
   *
   * EL ANTICIPO NO ENTRA. El anexo liga `$PrepaidAmount` y no lo usa; ver el
   * aviso en la cabecera del archivo. Se informa en `details` cuando el
   * documento lo trae, precisamente para que quien lea el hallazgo NO intente
   * cuadrar la cuenta restándolo.
   *
   * Los operandos se leen DECLARADOS, no recomputados: si el
   * `cbc:TaxInclusiveAmount` está mal, el hallazgo es de FAU06 y esta regla no
   * lo repite.
   */
  private static checkPayableAmount(
    root: any,
    root_name: string,
    family: DocumentFamily,
    violations: DianTotalsViolation[],
  ): void {
    const rule = this.ruleId('payable_amount', root_name);
    if (!rule) return;

    const group = this.monetaryTotalGroup(root, family);
    if (!group) return;

    const declared_text = this.textOfChild(group, 'cbc:PayableAmount');
    if (declared_text === null) return;

    const declared = toDecimal(declared_text);

    const inclusive_text = this.firstText(root, 'cbc:TaxInclusiveAmount');
    const allowance_text = this.firstText(root, 'cbc:AllowanceTotalAmount');
    const charge_text = this.firstText(root, 'cbc:ChargeTotalAmount');

    const expected = toDecimal(inclusive_text ?? 0)
      .minus(toDecimal(allowance_text ?? 0))
      .plus(toDecimal(charge_text ?? 0));

    if (this.pesos(declared) === this.pesos(expected)) return;

    const prepaid = this.sumPrepaidAmounts(root);

    violations.push({
      rule,
      kind: 'payable-amount-mismatch',
      path: `${root_name}/cac:${family.monetary_total}/cbc:PayableAmount`,
      message:
        `La cabecera declara un valor a pagar de ${declared_text}, pero ` +
        `${inclusive_text ?? '0.00'} (bruto más tributos) − ` +
        `${allowance_text ?? '0.00'} (descuento total) + ` +
        `${charge_text ?? '0.00'} (cargo total) da ${expected.toFixed(2)}. ` +
        `La regla ${rule} rechaza la diferencia.` +
        (prepaid.isZero()
          ? ''
          : ` El documento informa ${prepaid.toFixed(2)} de anticipo: NO se ` +
            `resta del valor a pagar — el anexo lo liga y no lo usa, así que ` +
            `descontarlo es lo que produce este mismo rechazo.`),
      details: {
        declared: declared_text,
        tax_inclusive: inclusive_text ?? '0.00',
        allowance_total: allowance_text ?? '0.00',
        charge_total: charge_text ?? '0.00',
        expected: expected.toFixed(2),
        difference: declared.minus(expected).toFixed(2),
        prepaid_informed: prepaid.toFixed(2),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // RESOLUCIÓN DE IDENTIFICADORES Y ARITMÉTICA
  // ---------------------------------------------------------------------------

  /**
   * Identificador oficial de la regla para ESTA raíz, leído del catálogo, o
   * `null` si el anexo no la publica para ella.
   *
   * `null` hace que la comprobación no corra, y eso es deliberado: sin cita no
   * hay forma de que quien reciba el rechazo lo correlacione con este gate, y un
   * identificador inventado por concatenación es peor que no tenerlo.
   */
  private static ruleId(key: DianRuleKey, root_name: string): string | null {
    const variant = DIAN_RULES[key].by_root[root_name as DianUblRootDocument];
    return variant?.id ?? null;
  }

  /** El grupo de totales de ESTE documento, como hijo directo de la raíz. */
  private static monetaryTotalGroup(
    root: any,
    family: DocumentFamily,
  ): any | null {
    const [group] = this.childrenNamed(root, `cac:${family.monetary_total}`);
    return group ?? null;
  }

  /**
   * `sum(//cac:TaxTotal[not(ancestor::<línea>)]/cbc:TaxAmount)`.
   *
   * El `continue` sobre el elemento de línea implementa el `not(ancestor::)`:
   * descarta la línea Y todo su subárbol de una vez. `cac:WithholdingTaxTotal`
   * no entra porque su nombre no es `cac:TaxTotal`.
   */
  private static sumHeaderTaxAmounts(
    root: any,
    line_element: string,
  ): ReturnType<typeof toDecimal> {
    let total = toDecimal(0);

    const walk = (element: any): void => {
      for (const node of this.childElements(element)) {
        const qname = this.qualifiedName(node);
        if (qname === line_element) continue;
        if (qname === 'cac:TaxTotal') {
          const amount = this.textOfChild(node, 'cbc:TaxAmount');
          if (amount !== null) total = total.plus(toDecimal(amount));
        }
        walk(node);
      }
    };

    walk(root);
    return total;
  }

  /** `sum(//cac:PrepaidPayment/cbc:PaidAmount)` — informativo, ver FAU14. */
  private static sumPrepaidAmounts(root: any): ReturnType<typeof toDecimal> {
    let total = toDecimal(0);

    const walk = (element: any): void => {
      for (const node of this.childElements(element)) {
        if (this.qualifiedName(node) === 'cac:PrepaidPayment') {
          const amount = this.textOfChild(node, 'cbc:PaidAmount');
          if (amount !== null) total = total.plus(toDecimal(amount));
        }
        walk(node);
      }
    };

    walk(root);
    return total;
  }

  /**
   * A peso entero, que es la precisión a la que comparan las reglas (`round()`).
   * Comparar con más precisión inventaría rechazos que la DIAN no produce: el
   * truncado hoja por hoja separa dos representaciones del mismo importe en
   * centavos.
   */
  private static pesos(value: ReturnType<typeof toDecimal>): string {
    return value.toDecimalPlaces(0).toString();
  }

  /** Texto del PRIMER descendiente con ese nombre, o `null` si no hay ninguno. */
  private static firstText(root: any, qname: string): string | null {
    const node = this.findFirst(root, qname);
    return node ? this.textOf(node) : null;
  }

  // ---------------------------------------------------------------------------
  // RECORRIDO DEL DOM
  // ---------------------------------------------------------------------------

  /** Visita el elemento y todos sus descendientes, con su ruta acumulada. */
  private static walkAll(
    element: any,
    path: string,
    visit: (node: any, qname: string, path: string) => void,
  ): void {
    const counts = new Map<string, number>();

    for (const node of this.childElements(element)) {
      const qname = this.qualifiedName(node);
      const seen = (counts.get(qname) ?? 0) + 1;
      counts.set(qname, seen);

      const child_path = `${path}/${qname}[${seen}]`;
      visit(node, qname, child_path);
      this.walkAll(node, child_path, visit);
    }
  }

  /** Primer descendiente con ese nombre calificado, en orden de documento. */
  private static findFirst(element: any, qname: string): any {
    for (const node of this.childElements(element)) {
      if (this.qualifiedName(node) === qname) return node;
      const found = this.findFirst(node, qname);
      if (found) return found;
    }
    return null;
  }

  /** Hijos DIRECTOS con ese nombre calificado. Los XPath de la DIAN son así. */
  private static childrenNamed(element: any, qname: string): any[] {
    return this.childElements(element).filter(
      (node) => this.qualifiedName(node) === qname,
    );
  }

  private static textOfChild(element: any, qname: string): string | null {
    const [node] = this.childrenNamed(element, qname);
    return node ? this.textOf(node) : null;
  }

  private static textOf(node: any): string {
    return String(node.textContent ?? '').trim();
  }

  private static childElements(element: any): any[] {
    const out: any[] = [];
    const children = element.childNodes;
    for (let i = 0; i < (children?.length ?? 0); i++) {
      const node = children[i];
      if (node?.nodeType === 1) out.push(node);
    }
    return out;
  }

  /**
   * Nombre calificado por NAMESPACE, no por el prefijo literal del documento:
   * el prefijo es libre y comparar prefijos ataría el validador a un detalle de
   * serialización.
   */
  private static qualifiedName(node: any): string {
    const local: string = node.localName || node.nodeName;
    const ns: string | null = node.namespaceURI;
    const prefix = ns ? NAMESPACE_PREFIXES[ns] : undefined;
    return prefix ? `${prefix}:${local}` : local;
  }
}

/** Resumen de una línea por violación, para logs y `details` de excepciones. */
export function summarizeDianTotalsViolations(
  violations: readonly DianTotalsViolation[],
  limit = 5,
): string[] {
  return violations
    .slice(0, limit)
    .map((v) => `[${v.rule}] ${v.path}: ${v.message}`);
}
