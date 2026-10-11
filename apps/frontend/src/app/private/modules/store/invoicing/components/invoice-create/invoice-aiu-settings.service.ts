import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

/**
 * DEFAULTS EXPLÍCITOS PARA CAPTURAR UN DOCUMENTO AIU SIN PERFIL.
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
 * El perfil de facturación o los datos del documento pueden reemplazar estos
 * defaults. Nunca se consultan preferencias fiscales vivas del tenant: el
 * documento debe declarar su propio objeto de contrato y configuración.
 *
 * El piso 10 % se habilita explícitamente como default conservador; un
 * documento puede desactivarlo cuando corresponda.
 */

/** Valores iniciales explícitos del formulario AIU sin un perfil seleccionado. */
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

const DOCUMENT_DEFAULTS: InvoiceAiuSettings = {
  regime: 'et_462_1',
  contract_object: '',
  enforce_minimum_base: true,
  minimum_base_percent: 10,
  note: '',
  note_length: 0,
  // Sin objeto de contrato no existe la nota mínima que exige la regla CAV03;
  // la factura debe declararlo antes de emitirse.
  note_valid: false,
  note_min_length: 20,
  note_max_length: 5000,
  note_prefix: 'Contrato de servicios AIU por concepto de:',
  is_default: true,
};

@Injectable({ providedIn: 'root' })
export class InvoiceAiuSettingsService {
  /** Mantiene la API observable para los callers del formulario de factura. */
  private settings$: Observable<InvoiceAiuSettings> | null = null;

  load(): Observable<InvoiceAiuSettings> {
    if (!this.settings$) {
      this.settings$ = of(DOCUMENT_DEFAULTS).pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.settings$;
  }

  /** Conserva compatibilidad con callers que reinician el formulario. */
  invalidate(): void {
    this.settings$ = null;
  }
}
