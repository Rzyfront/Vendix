import { DOMParser } from '@xmldom/xmldom';
import { toDecimal } from '../../../utils/dian-money.util';

/**
 * Comprueba sobre el XML YA ARMADO las dos reglas de totalización que la DIAN
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
 * LAS DOS REGLAS
 * --------------
 *
 * · **FAS01b / CAS01b / DAS01b** — «se presenta cuando una factura no tiene
 *   impuestos pero aparece el nodo `<cac:TaxTotal>`». La causa que el anexo
 *   lista primero es exactamente la nuestra: «se reportan ítems excluidos de
 *   impuestos, pero se detalla una totalización con tarifa igual a 0 %».
 *
 *   Un EXCLUIDO (art. 476 ET) no está sujeto al impuesto: no informa el grupo,
 *   ni en la línea ni en la cabecera. Un EXENTO (art. 477 ET) sí está gravado,
 *   a tarifa cero: informa `cac:TaxSubtotal` con `cbc:Percent` en `0.00`. Por
 *   eso la señal no es «el importe es cero» sino «el grupo no trae subtotales».
 *
 * · **FAU04 / CAU04 / DAU04** —
 *   `round(//cbc:TaxExclusiveAmount) == round(sum(//cac:InvoiceLine/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount))`.
 *   La cabecera sólo puede declarar como base imponible lo que sus líneas
 *   declaran como base. Una línea que omite su grupo de tributos no aporta
 *   ninguna, así que no puede sumar en la cabecera.
 *
 * Se implementan sobre el DOM y no con la aritmética del emisor a propósito: el
 * valor de esta compuerta está en LEER lo que se va a transmitir, no en
 * recalcularlo por segunda vez desde la misma fuente.
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
const DOCUMENT_FAMILIES: Readonly<
  Record<string, { letter: string; line_element: string }>
> = {
  Invoice: { letter: 'F', line_element: 'cac:InvoiceLine' },
  CreditNote: { letter: 'C', line_element: 'cac:CreditNoteLine' },
  DebitNote: { letter: 'D', line_element: 'cac:DebitNoteLine' },
};

export type DianTotalsViolationKind =
  | 'tax-total-without-subtotal'
  | 'tax-exclusive-base-mismatch'
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
    this.checkTaxTotalsHaveSubtotals(root, root_name, family.letter, violations);
    this.checkTaxExclusiveBase(root, root_name, family, violations);

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
          `documento (${rule}). Un ítem EXCLUIDO no informa el grupo de tributos; ` +
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
    family: { letter: string; line_element: string },
    violations: DianTotalsViolation[],
  ): void {
    const rule = `${family.letter}AU04`;

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
