import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';

/**
 * CATÁLOGO DE CONCEPTOS DE RETENCIÓN DE LA TIENDA (`withholding_concepts`).
 *
 * ─── POR QUÉ EXISTE ─────────────────────────────────────────────────────────
 *
 * `InvoiceWithholdingInputDto` exige `concept_id: number` —el id de la fila del
 * catálogo—, no un texto. El backend lo usa para leer `withholding_type`,
 * `concept_code` y la cuenta PUC de la retención, y rechaza con
 * `INVOICING_WITHHOLDING_002` cualquier id que no pertenezca al tenant. Sin
 * este catálogo la sección de retenciones sólo puede capturar texto libre, que
 * es exactamente lo que hacía antes: el formulario se veía completo y el
 * payload salía sin una sola retención.
 *
 * ─── LA UNIDAD DE LA TARIFA (acá se pierde un factor de 100) ────────────────
 *
 * `withholding_concepts.rate` es `Decimal(7,4)` y guarda una **FRACCIÓN**:
 * `WithholdingCalculatorService` computa `amount * rate` sin dividir entre 100,
 * y `applyClientDeclaredWithholdings` hace lo mismo con `base.times(rate)`. La
 * UI, en cambio, escribe y lee PORCENTAJE porque es lo que un contador teclea.
 *
 * La conversión vive **sólo aquí y en el mapeo del payload**, en un único
 * sentido cada una, para que no haya un tercer sitio donde la escala se pueda
 * confundir. El `@Max(1)` del DTO es la red de seguridad del backend si algún
 * día alguien salta este servicio.
 */

/** Fila de `withholding_concepts` tal como la devuelve el backend. */
interface WithholdingConceptRow {
  id: number;
  code: string;
  name: string;
  /** Decimal serializado: llega como string ("0.0250") o como number. */
  rate?: string | number | null;
  withholding_type?: string | null;
  applies_to?: string | null;
  is_active?: boolean | null;
}

interface WithholdingConceptListResponse {
  success?: boolean;
  data?: WithholdingConceptRow[];
}

/** Concepto listo para el selector del formulario. */
export interface WithholdingConceptOption {
  id: number;
  code: string;
  name: string;
  /** Tarifa en PORCENTAJE, lista para pintar y para el input «Tarifa %». */
  ratePercent: number;
  /** `retefuente` | `reteiva` | `reteica` | … — se muestra como etiqueta. */
  withholdingType: string | null;
}

@Injectable({ providedIn: 'root' })
export class InvoiceWithholdingCatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl + '/store/withholding-tax/concepts';

  /**
   * Una sola petición por sesión: el catálogo cambia cuando el contador crea un
   * concepto, no mientras teclea una factura. `shareReplay` sin `refCount` para
   * que reabrir el modal no vuelva a pegarle al servidor.
   */
  private catalog$: Observable<WithholdingConceptOption[]> | null = null;

  load(): Observable<WithholdingConceptOption[]> {
    if (!this.catalog$) {
      this.catalog$ = this.http
        .get<WithholdingConceptListResponse>(this.url)
        .pipe(
          map((response) =>
            (response?.data ?? [])
              // Un concepto inactivo sigue siendo válido para documentos
              // históricos, pero no debe ofrecerse para uno nuevo.
              .filter((row) => row.is_active !== false)
              .map((row) => this.toOption(row)),
          ),
          // Un catálogo que no carga NO tumba el modal: la retención se puede
          // escribir a mano con el toggle de importe manual, y la sección
          // muestra por qué la lista está vacía.
          catchError(() => of([] as WithholdingConceptOption[])),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.catalog$;
  }

  /** Fuerza una recarga (p. ej. tras crear un concepto en otra pantalla). */
  invalidate(): void {
    this.catalog$ = null;
  }

  private toOption(row: WithholdingConceptRow): WithholdingConceptOption {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      ratePercent: toPercent(row.rate),
      withholdingType: row.withholding_type ?? null,
    };
  }
}

/**
 * Fracción → porcentaje.
 *
 * Sin guardarraíl del `> 1` a propósito, al revés que en el catálogo de
 * impuestos: `withholding_concepts.rate` no tiene camino legado que haya
 * escrito porcentajes, y una tarifa de retención del 100 % o más no existe. Si
 * el dato viniera en porcentaje, multiplicar por 100 lo vuelve absurdo a la
 * vista del usuario — que es preferible a esconderlo.
 */
function toPercent(raw: string | number | null | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  // Dos decimales: `Decimal(7,4)` da como mucho 0.0001 → 0.01 %, y arrastrar el
  // artefacto de coma flotante (0.025 * 100 = 2.5000000000000004) haría que el
  // usuario viera una tarifa que nadie escribió.
  return Math.round(value * 100 * 100) / 100;
}
