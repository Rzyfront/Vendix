import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { parseApiError } from '../../core/utils/parse-api-error';
import { SaveRequirement } from '../components/index';
import {
  FISCAL_RESTRICTION_MAP,
  FiscalConfigChecklistItem,
  checklistToRequirements,
  mapFiscalBackendErrorToRequirements,
} from '../components/fiscal-activation-wizard/utils/fiscal-requirements.util';

/**
 * Estado + orquestacion del modal de requisitos fiscales para las superficies
 * OPERATIVAS (facturacion, dashboard fiscal, etc.), fuera del wizard de
 * activacion.
 *
 * Reutiliza el mismo modal (`app-save-requirements-modal`) y el mismo mapa de
 * restricciones (`fiscal-requirements.util`) que el wizard, para que un 4xx
 * fiscal que bloquea una operacion se explique con el MISMO lenguaje humano y
 * el MISMO CTA que en la activacion.
 *
 * Singleton (`providedIn: 'root'`): cada superficie inyecta el servicio, monta
 * `<app-save-requirements-modal [(isOpen)]="fiscalReq.isOpen" ...>` en su
 * template y enruta sus errores fiscales por `present()` / `presentFiscalError()`.
 */
@Injectable({ providedIn: 'root' })
export class FiscalRequirementsService {
  private readonly router = inject(Router);

  /** Visibilidad del modal (two-way con `app-save-requirements-modal`). */
  readonly isOpen = signal(false);

  /** Filas de requisitos que el modal renderiza. */
  readonly requirements = signal<SaveRequirement[]>([]);

  /**
   * Traduce cualquier error fiscal a filas y abre el modal. Nunca abre vacio:
   * si el mapa devuelve `[]`, no abre y devuelve `false` (el consumidor deja
   * pasar el error por su flujo normal). Devuelve `true` si abrio, para que el
   * consumidor suprima su toast crudo.
   */
  present(error: unknown): boolean {
    const rows = mapFiscalBackendErrorToRequirements(error);
    if (rows.length === 0) {
      return false;
    }
    this.requirements.set(rows);
    this.isOpen.set(true);
    return true;
  }

  /**
   * Igual que `present`, pero SOLO intercepta cuando el error es una restriccion
   * fiscal reconocida (codigo curado en `FISCAL_RESTRICTION_MAP` o pasos
   * faltantes `FISCAL_STATUS_INCOMPLETE`). Para el resto de errores devuelve
   * `false` sin abrir, para no secuestrar errores no-fiscales (5xx, red, etc.).
   * Pensado para superficies como facturacion donde solo los 4xx fiscales deben
   * mostrar el modal de requisitos.
   */
  presentFiscalError(error: unknown): boolean {
    if (!this.isFiscalRestriction(error)) {
      return false;
    }
    return this.present(error);
  }

  /** Abre el modal a partir de un checklist fiscal del backend. */
  presentFromChecklist(
    items: FiscalConfigChecklistItem[] | null | undefined,
  ): boolean {
    const rows = checklistToRequirements(items);
    if (rows.length === 0) {
      return false;
    }
    this.requirements.set(rows);
    this.isOpen.set(true);
    return true;
  }

  /**
   * `true` si el error corresponde a una restriccion fiscal reconocida: un
   * codigo presente en el catalogo curado o `FISCAL_STATUS_INCOMPLETE`.
   */
  isFiscalRestriction(error: unknown): boolean {
    const code = parseApiError(error).errorCode;
    if (!code) {
      return false;
    }
    return code === 'FISCAL_STATUS_INCOMPLETE' || code in FISCAL_RESTRICTION_MAP;
  }

  /** Cierra el modal sin limpiar las filas (se sobreescriben en el proximo present). */
  close(): void {
    this.isOpen.set(false);
  }

  /**
   * Ejecuta el CTA de una fila. Para `navigate` lleva al usuario a la ruta de
   * configuracion correcta y cierra el modal. `target` puede ser una ruta
   * absoluta (`/admin/fiscal`) o un id de paso del wizard; los ids de paso no
   * son rutas navegables desde una superficie operativa, asi que caen al hub
   * fiscal donde vive el asistente de configuracion.
   */
  handleAction(req: SaveRequirement): void {
    const action = req.action;
    this.close();
    if (action?.kind === 'navigate' && action.target) {
      const url = action.target.startsWith('/') ? action.target : '/admin/fiscal';
      void this.router.navigateByUrl(url);
    }
  }
}
