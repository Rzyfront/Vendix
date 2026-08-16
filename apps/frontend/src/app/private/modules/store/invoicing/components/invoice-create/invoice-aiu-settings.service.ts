import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

import { environment } from '../../../../../../../environments/environment';

/**
 * CONFIGURACIÓN AIU EFECTIVA DE LA TIENDA.
 *
 * ─── POR QUÉ ESTO NO PUEDE SER UN TEXTO FIJO EN LA UI ────────────────────────
 *
 * Existen dos bases gravables incompatibles y ninguna se deduce del documento:
 *
 * · `et_462_1` — E.T. art. 462-1 (aseo y cafetería, vigilancia, servicios
 *   temporales de empleo): grava el AIU **completo**, con piso del 10 % del
 *   valor del contrato.
 * · `decreto_1372_1992` — Decreto 1372/1992 art. 3 (construcción de inmueble):
 *   grava **únicamente la Utilidad**.
 *
 * Cuál rige lo decide el objeto del CONTRATO. Un instructivo fijo en el modal
 * —cualquiera de los dos— le dice a la mitad de las tiendas que graven mal, y
 * el error no produce ningún síntoma: la DIAN acepta el documento y el faltante
 * sólo aparece en una fiscalización, ya con la sanción corriendo. Por eso el
 * aviso se pinta desde la configuración real, no desde una constante.
 *
 * ─── POR QUÉ NO SE LEE DE `GET /store/settings` ──────────────────────────────
 *
 * Porque ese endpoint exige `store:settings:read`, y quien captura facturas no
 * necesariamente administra la tienda. Colgarlo de ahí dejaría el aviso en
 * blanco justo para el perfil que más lo necesita. `GET
 * /store/invoicing/aiu-settings` responde lo mismo bajo `invoicing:read`.
 */

/** Espejo de `InvoicingService.getAiuSettingsView()` del backend. */
export interface InvoiceAiuSettings {
  regime: 'et_462_1' | 'decreto_1372_1992';
  contract_object: string;
  enforce_minimum_base: boolean;
  minimum_base_percent: number;
  /** Cadena exacta que iría en `cbc:Note` de la línea de Administración. */
  note: string;
  note_length: number;
  /** `false` ⇒ la emisión se va a rechazar por la regla CAV03. */
  note_valid: boolean;
  note_min_length: number;
  note_max_length: number;
  note_prefix: string;
  /** `true` cuando la tienda nunca guardó la sección `invoicing.aiu`. */
  is_default: boolean;
}

interface AiuSettingsResponse {
  success?: boolean;
  data?: InvoiceAiuSettings;
}

/**
 * Mismo default CONSERVADOR que el backend: si la lectura falla, se instruye
 * bajo `et_462_1`, que grava de más. Sobre-declarar se recupera; sub-declarar
 * se sanciona.
 */
const FALLBACK: InvoiceAiuSettings = {
  regime: 'et_462_1',
  contract_object: '',
  enforce_minimum_base: true,
  minimum_base_percent: 10,
  note: '',
  note_length: 0,
  // `true` a propósito: el fallback significa «no se pudo consultar», no «está
  // mal configurado». Pintar una alerta roja por un fallo de red mandaría al
  // usuario a arreglar algo que probablemente ya está bien.
  note_valid: true,
  note_min_length: 20,
  note_max_length: 5000,
  note_prefix: 'Contrato de servicios AIU por concepto de:',
  is_default: true,
};

@Injectable({ providedIn: 'root' })
export class InvoiceAiuSettingsService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl + '/store/invoicing/aiu-settings';

  /**
   * Una petición por sesión. La configuración cambia cuando el comerciante
   * edita Ajustes → Facturación, no mientras teclea una factura.
   */
  private settings$: Observable<InvoiceAiuSettings> | null = null;

  load(): Observable<InvoiceAiuSettings> {
    if (!this.settings$) {
      this.settings$ = this.http.get<AiuSettingsResponse>(this.url).pipe(
        map((response) => response?.data ?? FALLBACK),
        catchError(() => of(FALLBACK)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.settings$;
  }

  /** Fuerza una recarga (p. ej. tras editar el AIU en Ajustes). */
  invalidate(): void {
    this.settings$ = null;
  }
}
