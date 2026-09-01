import { DOMParser } from '@xmldom/xmldom';
import {
  UBL_CONTENT_MODEL,
  UBL_ELEMENT_TYPES,
  UBL_ROOT_TYPES,
} from '../constants/dian-ubl-content-model';
import { getProfileRestriction } from '../constants/dian-profile-restrictions';

/**
 * Valida el XML construido contra el modelo de contenido de los XSD oficiales
 * de la DIAN, ANTES de firmarlo y transmitirlo.
 *
 * QUÉ PROBLEMA RESUELVE
 * ---------------------
 * UBL fija el ORDEN de los hijos de cada elemento por `xsd:sequence`. Los
 * builders lo respetan porque alguien lo escribió bien y dejó un comentario
 * pidiendo que no se mueva —`ubl-invoice.builder.ts` dice literalmente «UBL fixes
 * the order PaymentTerms → AllowanceCharge → TaxTotal → LegalMonetaryTotal, so
 * this must precede the tax totals»—. Eso es un comentario, no una compuerta: la
 * próxima persona que inserte un bloque nuevo dos líneas más arriba produce un
 * documento con todo el contenido correcto y el orden inválido. La DIAN lo
 * rechaza por esquema, el mensaje no dice qué elemento sobra ni dónde, y el
 * consecutivo autorizado ya se gastó.
 *
 * Este validador convierte ese comentario en una verificación. Corre sobre el
 * XML ya armado, así que no depende de que el builder recuerde nada.
 *
 * QUÉ NO VALIDA
 * -------------
 * Facetas de tipos simples: patrones, longitudes, rangos numéricos. Las cubre
 * `FiscalDocumentValidator`, que además responde en español y cita la regla del
 * Anexo Técnico en vez de un error de esquema. Aquí sólo se comprueba la
 * ESTRUCTURA: qué hijos, en qué orden, cuántas veces.
 *
 * Los elementos cuyo tipo no está en el modelo se tratan como opacos y no se
 * recorren. Eso cubre a propósito dos casos: los tipos simples (`cbc:*`, que no
 * tienen hijos que ordenar) y `ext:ExtensionContent`, declarado `xsd:any` en el
 * esquema — es donde entran la extensión `sts:DianExtensions` y la firma XAdES,
 * cuyo contenido no lo gobierna la secuencia de UBL.
 *
 * Los nodos se recorren como `any`, igual que en `xades-epes-builder.ts`: el DOM
 * de `@xmldom/xmldom` no es estructuralmente el `Element` de `lib.dom`, y forzar
 * la equivalencia con casts sólo añade ruido sin ganar comprobación real.
 *
 * RESTRICCIONES DEL PERFIL DIAN SOBRE EL MODELO GENERADO
 * --------------------------------------------------------
 * El modelo generado describe UBL 2.1 genérico, y en varios puntos es más
 * laxo que lo que la DIAN acepta — el caso que motivó esto es
 * `CustomerPartyType.cbc:AdditionalAccountID`, `0..*` en el XSD y `1..1` en el
 * perfil DIAN. Esas diferencias viven en `dian-profile-restrictions.ts`, NUNCA
 * dentro de `dian-ubl-content-model.ts` (que se regenera desde los XSD), y se
 * consultan aquí con `getProfileRestriction()` al resolver cardinalidad
 * (`'too-many'`) y valores permitidos (`'bad-value'`).
 */

/** Namespace → prefijo canónico, el mismo que usa el modelo generado. */
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

export type UblViolationKind =
  | 'order'
  | 'unknown-child'
  | 'missing'
  | 'too-many'
  | 'malformed'
  | 'bad-value';

export interface UblStructureViolation {
  /** Ruta al elemento, estilo XPath simplificado: `Invoice/cac:TaxTotal[2]`. */
  path: string;
  kind: UblViolationKind;
  /** Mensaje en español, listo para `details` de una excepción tipada. */
  message: string;
}

export interface UblStructureResult {
  valid: boolean;
  violations: UblStructureViolation[];
  /**
   * Nombre del elemento raíz reconocido, o `null` si el documento no es uno de
   * los cinco que el modelo describe. Distingue «no se validó» de «se validó y
   * pasó»: sin este campo, un documento no reconocido saldría con `valid: true`
   * y cero violaciones, indistinguible de uno correcto.
   */
  root: string | null;
}

export class UblStructureValidator {
  /**
   * @param xml XML completo, con o sin declaración. Se parsea aquí; el llamador
   *   no necesita mantener un DOM vivo.
   */
  static validate(xml: string): UblStructureResult {
    // `@xmldom/xmldom` reporta los errores de parseo por callback, no lanzando.
    // Sin capturarlos, un XML mal formado se degrada a un DOM parcial y este
    // validador diría que todo está bien sobre un documento que no lo está.
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
      parse_errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (parse_errors.length > 0) {
      return {
        valid: false,
        root: null,
        violations: [
          {
            path: '/',
            kind: 'malformed',
            message: `El XML generado no está bien formado: ${parse_errors[0]}`,
          },
        ],
      };
    }

    const root: any = doc?.documentElement;
    if (!root) {
      return {
        valid: false,
        root: null,
        violations: [
          {
            path: '/',
            kind: 'malformed',
            message: 'El XML generado no tiene elemento raíz.',
          },
        ],
      };
    }

    const root_name: string = root.localName || root.nodeName;
    const root_type = UBL_ROOT_TYPES[root_name];
    if (!root_type) {
      return {
        valid: false,
        root: null,
        violations: [
          {
            path: `/${root_name}`,
            kind: 'malformed',
            message:
              `El documento raíz «${root_name}» no corresponde a ninguno de los ` +
              `tipos que la DIAN describe (${Object.keys(UBL_ROOT_TYPES).join(', ')}).`,
          },
        ],
      };
    }

    const violations: UblStructureViolation[] = [];
    this.walk(root, root_type, root_name, violations);

    return { valid: violations.length === 0, violations, root: root_name };
  }

  /**
   * Recorre un elemento contra la secuencia de su tipo.
   *
   * Se implementa como un avance monótono sobre la secuencia: cada hijo del XML
   * busca su posición desde el cursor actual hacia adelante. Encontrarlo ANTES
   * del cursor significa que el documento lo emitió tarde —está fuera de orden—;
   * no encontrarlo en absoluto significa que el tipo no lo admite. Esa es
   * exactamente la distinción que un rechazo por esquema de la DIAN no hace.
   */
  private static walk(
    element: any,
    type_name: string,
    path: string,
    violations: UblStructureViolation[],
  ): void {
    const model = UBL_CONTENT_MODEL[type_name];
    if (!model) return; // tipo simple u opaco (`xsd:any`): sin secuencia que revisar

    const index_of = new Map<string, number>();
    model.forEach((child, i) => index_of.set(child.ref, i));

    const counts = new Map<string, number>();
    let cursor = 0;

    for (const node of this.childElements(element)) {
      const qname = this.qualifiedName(node);
      const position = index_of.get(qname);

      if (position === undefined) {
        violations.push({
          path: `${path}/${qname}`,
          kind: 'unknown-child',
          message:
            `«${qname}» no es un hijo válido de «${type_name}». El esquema UBL ` +
            `sólo admite: ${model.map((c) => c.ref).join(', ')}.`,
        });
        continue;
      }

      if (position < cursor) {
        violations.push({
          path: `${path}/${qname}`,
          kind: 'order',
          message:
            `«${qname}» está fuera de orden dentro de «${type_name}»: el esquema ` +
            `lo ubica antes de «${model[cursor].ref}», y aquí se emitió después. ` +
            `UBL fija el orden por xsd:sequence, así que la DIAN rechaza el ` +
            `documento aunque el contenido sea correcto.`,
        });
        // El cursor NO retrocede: hacerlo convertiría un solo bloque desplazado
        // en una cascada de violaciones sobre todo lo que viene detrás, y el
        // primer mensaje —el único que señala la causa— quedaría enterrado.
      } else {
        cursor = position;
      }

      const occurrence = (counts.get(qname) ?? 0) + 1;
      counts.set(qname, occurrence);

      const child_path =
        model[position].max === 1
          ? `${path}/${qname}`
          : `${path}/${qname}[${occurrence}]`;

      // Valores permitidos del PERFIL DIAN. Se comprueba aquí, no dentro de
      // `walk()` recursivo, porque el elemento restringido hoy (`cbc:*`) es
      // un tipo simple: no está en `UBL_ELEMENT_TYPES`, así que nunca se
      // recorre y su `textContent` sólo es legible desde el padre que sí se
      // recorre.
      const restriction = getProfileRestriction(type_name, qname);
      if (restriction?.allowedValues) {
        const value = String(node.textContent ?? '').trim();
        if (!restriction.allowedValues.includes(value)) {
          violations.push({
            path: child_path,
            kind: 'bad-value',
            message:
              `«${qname}» tiene el valor «${value}» en «${type_name}», y el ` +
              `perfil DIAN sólo admite: ${restriction.allowedValues.join(', ')}.`,
          });
        }
      }

      const child_type = UBL_ELEMENT_TYPES[qname];
      if (child_type) {
        this.walk(node, child_type, child_path, violations);
      }
    }

    for (const child of model) {
      const seen = counts.get(child.ref) ?? 0;
      const restriction = getProfileRestriction(type_name, child.ref);
      const effective_max = this.effectiveMax(child.max, restriction?.max);

      if (seen < child.min) {
        violations.push({
          path: `${path}/${child.ref}`,
          kind: 'missing',
          message:
            `Falta «${child.ref}» en «${type_name}»: el esquema lo exige al menos ` +
            `${child.min} vez${child.min === 1 ? '' : 'es'} y no se emitió ninguna.`,
        });
      } else if (effective_max !== -1 && seen > effective_max) {
        violations.push({
          path: `${path}/${child.ref}`,
          kind: 'too-many',
          message:
            `«${child.ref}» aparece ${seen} veces en «${type_name}» y el ` +
            (restriction?.max !== undefined
              ? `perfil DIAN admite como máximo ${effective_max}.`
              : `esquema admite como máximo ${effective_max}.`),
        });
      }
    }
  }

  /**
   * El más estricto entre el `max` del modelo generado (XSD) y el del
   * override del perfil DIAN, tratando `-1` (`unbounded`) como el valor menos
   * restrictivo posible. Un override nunca RELAJA un límite que el XSD ya
   * puso más bajo.
   */
  private static effectiveMax(
    model_max: number,
    override_max: number | undefined,
  ): number {
    if (override_max === undefined) return model_max;
    if (model_max === -1) return override_max;
    return Math.min(model_max, override_max);
  }

  private static childElements(element: any): any[] {
    const out: any[] = [];
    const nodes = element.childNodes;
    if (!nodes) return out;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      // 1 === ELEMENT_NODE. Se compara el número porque `Node` no existe como
      // valor en runtime bajo Node.js y `@xmldom/xmldom` no lo exporta.
      if (node && node.nodeType === 1) out.push(node);
    }
    return out;
  }

  /**
   * QName canónico del nodo. Se resuelve por NAMESPACE, no por el prefijo
   * literal del documento: el prefijo es libre —un firmante puede reescribir
   * `cbc:` como `ns2:` sin cambiar el significado— y comparar prefijos haría que
   * el validador dependiera de un detalle de serialización.
   */
  private static qualifiedName(node: any): string {
    const local: string = node.localName || node.nodeName;
    const ns: string | null = node.namespaceURI;
    const prefix = ns ? NAMESPACE_PREFIXES[ns] : undefined;
    return prefix ? `${prefix}:${local}` : local;
  }
}

/** Resumen de una línea por violación, para logs y `details` de excepciones. */
export function summarizeUblViolations(
  violations: readonly UblStructureViolation[],
  limit = 5,
): string[] {
  return violations.slice(0, limit).map((v) => `${v.path}: ${v.message}`);
}
