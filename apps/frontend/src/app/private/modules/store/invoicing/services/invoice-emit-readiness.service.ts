import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable } from 'rxjs';
import { catchError, filter, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

/**
 * Severidad de un hallazgo. Espejo LITERAL de `FiscalIdentitySeverity` y
 * `FiscalDocumentSeverity` (los dos validadores declaran la misma unión):
 * `apps/backend/src/domains/store/invoicing/validators/customer-fiscal-identity.validator.ts`
 * y `.../fiscal-document.validator.ts`. No se inventa un tercer valor: si allá
 * aparece uno, acá también, o el modal lo clasifica mal en silencio.
 */
export type InvoiceEmitReadinessSeverity = 'blocker' | 'warning';

/** Espejo de `AcquirerIdentificationMode`. */
export type InvoiceEmitReadinessMode = 'final_consumer' | 'nominative';

/**
 * Familia del hallazgo fiscal. Espejo de `FiscalDocumentFindingCategory`:
 * dice QUÉ se va a corregir, y por eso decide a dónde manda el CTA.
 */
export type InvoiceEmitReadinessCategory =
  | 'arithmetic'
  | 'resolution'
  | 'technical_key'
  | 'content';

/**
 * Un hallazgo de identidad del adquiriente.
 *
 * `problem` dice QUÉ está mal ante la DIAN; `fix` YA viene redactado en español
 * nombrando el clic exacto (los validadores definen rótulos como «Clientes →
 * abre la ficha del cliente → pestaña "Datos fiscales"»). Este contrato NO
 * reescribe esos textos: los transporta.
 *
 * `code` se declara `string` a propósito. En el backend es una unión cerrada de
 * ~40 literales que crece con cada regla nueva; duplicarla acá crearía un
 * segundo catálogo que se desactualiza en silencio y que rompería la
 * compilación por un código nuevo que el frontend sólo tiene que mostrar.
 */
export interface InvoiceEmitReadinessFinding {
  code: string;
  severity: InvoiceEmitReadinessSeverity;
  /** Campo del adquiriente al que apunta el hallazgo (`document_number`, `address.city_code`…). */
  field: string;
  problem: string;
  fix: string;
  details?: Record<string, unknown>;
}

/**
 * Un hallazgo del prevalidador del documento fiscal. Es el mismo contrato MÁS
 * `category`, que es lo que permite mandar los de `resolution` / `technical_key`
 * a otra pantalla en vez de a un campo del formulario.
 */
export interface InvoiceEmitReadinessFiscalFinding
  extends InvoiceEmitReadinessFinding {
  category: InvoiceEmitReadinessCategory;
}

/** Veredicto sobre el adquiriente. Espejo de `CustomerFiscalIdentityReport`. */
export interface InvoiceEmitReadinessIdentity {
  emittable: boolean;
  mode: InvoiceEmitReadinessMode;
  findings: InvoiceEmitReadinessFinding[];
  blockers: InvoiceEmitReadinessFinding[];
  warnings: InvoiceEmitReadinessFinding[];
  /** Identidad ya normalizada. Sólo viene poblada cuando `emittable` es `true`. */
  normalized: Record<string, unknown> | null;
}

/** Veredicto sobre el documento. Espejo de `FiscalDocumentReport`. */
export interface InvoiceEmitReadinessFiscalDocument {
  emittable: boolean;
  document_type: string;
  findings: InvoiceEmitReadinessFiscalFinding[];
  blockers: InvoiceEmitReadinessFiscalFinding[];
  warnings: InvoiceEmitReadinessFiscalFinding[];
  /** Importes recomputados con las mismas funciones que escriben el XML. */
  computed: Record<string, unknown>;
}

/**
 * Respuesta de `GET /store/invoicing/:id/emit-readiness`.
 *
 * OJO CON LA FORMA: los campos de identidad viajan APLANADOS en la raíz
 * (contrato heredado que el backend conserva a propósito) Y ADEMÁS repetidos
 * dentro de `identity`. Leer `identity` es lo inequívoco; la raíz existe para
 * los consumidores viejos.
 *
 * `emittable` de la raíz NO es el de identidad: es el AND de las DOS puertas
 * (identidad ∧ prevalidación fiscal). Es el único que se debe consultar para
 * decidir si el documento puede emitirse.
 *
 * `fiscal_document` es `null` cuando el `invoice_type` no se emite a la DIAN.
 * `null` NO significa "está mal": significa que no hay nada que prevalidar.
 */
export interface InvoiceEmitReadiness extends InvoiceEmitReadinessIdentity {
  /** El informe de identidad SIN aplanar. */
  identity: InvoiceEmitReadinessIdentity;
  /** `null` cuando el tipo de documento no viaja a la DIAN. */
  fiscal_document: InvoiceEmitReadinessFiscalDocument | null;
  invoice_id: number;
  invoice_number: string;
  status: string;
  has_items: boolean;
}

/**
 * LA PUERTA DE EMISIÓN, EN SÓLO LECTURA.
 *
 * El backend publica desde hace tiempo qué le falta a un documento para poder
 * emitirse, sin cambiar nada. Hasta ahora nadie lo consultaba: el comerciante
 * descubría esos problemas al pulsar «Validar» o, peor, en el rechazo de la
 * DIAN — que ya quemó el consecutivo autorizado y no se recupera.
 *
 * HTTP DIRECTO Y NO NGRX A PROPÓSITO. Esto no es estado del módulo: es una
 * consulta puntual, sin caché y sin efectos, sobre un documento concreto.
 * Meterla en el store obligaría a inventar acciones, reducer y selectores para
 * un dato que se lee una vez y se tira.
 *
 * NINGÚN MÉTODO LANZA. Es una puerta ASESORA: si el backend no contesta, la
 * pantalla tiene que comportarse exactamente como antes de que esta puerta
 * existiera, nunca peor.
 */
@Injectable({
  providedIn: 'root',
})
export class InvoiceEmitReadinessService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/invoicing`;

  /**
   * Qué le falta al documento para poder emitirse. Sólo lee; no numera, no
   * valida y no transmite.
   *
   * DEGRADACIÓN HONESTA: ante un error de red, un 403 o un cuerpo que no tiene
   * la forma del contrato, el observable COMPLETA SIN EMITIR (`EMPTY`) en vez de
   * fabricar un veredicto. Inventar `emittable: true` sería afirmar que el
   * documento está listo sin haberlo comprobado, y `emittable: false` abriría un
   * modal de requisitos vacío culpando al usuario de una falla del servidor.
   *
   * Corolario para quien lo consuma: `next` puede no dispararse nunca. Todo lo
   * que tenga que apagarse pase lo que pase (un spinner, por ejemplo) va en
   * `complete` o en `finalize`, no en `next`.
   */
  check(invoiceId: number): Observable<InvoiceEmitReadiness> {
    return this.http
      .get<unknown>(`${this.apiUrl}/${invoiceId}/emit-readiness`)
      .pipe(
        map((response) => this.unwrap(response)),
        // Predicado de tipo: el consumidor recibe `InvoiceEmitReadiness`, no
        // `… | null`, y un cuerpo irreconocible se comporta igual que un error
        // de red — completa sin veredicto.
        filter(
          (readiness): readiness is InvoiceEmitReadiness => readiness !== null,
        ),
        catchError(() => EMPTY),
      );
  }

  /**
   * Desenvuelve el sobre de `ResponseService.success(...)` y verifica que lo de
   * adentro sea realmente el informe. Un `data` sin `emittable` booleano no es
   * un informe degradado: es otra cosa, y tratarla como informe produciría un
   * veredicto inventado.
   */
  private unwrap(response: unknown): InvoiceEmitReadiness | null {
    const envelope = response as { data?: unknown } | null;
    const data = (envelope?.data ?? response) as Partial<InvoiceEmitReadiness>;
    if (!data || typeof data !== 'object') {
      return null;
    }
    if (typeof data.emittable !== 'boolean') {
      return null;
    }

    // `identity` es el informe inequívoco, pero se reconstruye desde la raíz
    // aplanada si faltara: los dos llevan los mismos campos y quedarse sin
    // hallazgos por elegir la copia equivocada es justo el fallo que este
    // endpoint viene a evitar.
    const identity = this.normalizeIdentity(data.identity ?? data);

    return {
      ...(data as InvoiceEmitReadiness),
      ...identity,
      // `emittable` de la raíz es el AND de las dos puertas y NO se puede pisar
      // con el de identidad, que sólo juzga al adquiriente.
      emittable: data.emittable,
      identity,
      fiscal_document: this.normalizeFiscalDocument(data.fiscal_document),
    };
  }

  private normalizeIdentity(
    raw: Partial<InvoiceEmitReadinessIdentity> | null | undefined,
  ): InvoiceEmitReadinessIdentity {
    return {
      emittable: raw?.emittable === true,
      mode: (raw?.mode ?? 'nominative') as InvoiceEmitReadinessMode,
      findings: asArray(raw?.findings),
      blockers: asArray(raw?.blockers),
      warnings: asArray(raw?.warnings),
      normalized: (raw?.normalized ?? null) as Record<string, unknown> | null,
    };
  }

  /**
   * `null` se CONSERVA como `null`: es el tipo de documento que no se emite a
   * la DIAN. Convertirlo en un informe vacío haría creer que se prevalidó algo.
   */
  private normalizeFiscalDocument(
    raw: InvoiceEmitReadinessFiscalDocument | null | undefined,
  ): InvoiceEmitReadinessFiscalDocument | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    return {
      ...raw,
      emittable: raw.emittable === true,
      findings: asArray(raw.findings),
      blockers: asArray(raw.blockers),
      warnings: asArray(raw.warnings),
      computed: (raw.computed ?? {}) as Record<string, unknown>,
    };
  }
}

/** Un arreglo del backend, o uno vacío. Nunca `undefined` río abajo. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
