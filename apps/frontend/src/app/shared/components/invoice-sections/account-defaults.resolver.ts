import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';

import { AccountingService } from '../../../accounting/services/accounting.service';
import type { AccountMapping } from '../../../accounting/interfaces/accounting.interface';
import type { InheritedAccountHint } from '../../../../../../shared/components/account-select/account-select.component';

/**
 * Las claves del mapeo contable de la tienda que la emisión AIU aplica HOY,
 * enumeradas leyendo el consumidor del asiento
 * (`apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`):
 *
 * - **Ingreso por porción** (`administracion`, `imprevistos`, `utilidad`,
 *   `costo`): NO existe clave por bucket en el catálogo. Todas las líneas —AIU
 *   o no— caen en `resolveInvoiceRevenueLines` con
 *   `default_mapping_key: 'invoice.validated.revenue'` (:1393-1400), salvo que
 *   la línea o su producto traigan cuenta propia. El valor efectivo del sistema
 *   para los CUATRO buckets es pues la misma clave.
 * - **IVA por pagar**: `resolveTaxLines` intenta primero la clave tipada
 *   `invoice.validated.iva_payable` y sólo si el mapeo falta retrocede a la
 *   legacy `invoice.validated.vat_payable` (:1403-1415).
 *
 * Un bucket sin clave resuelta ⇒ heredado vacío, sin inventar código: es
 * exactamente lo que hoy aplicaría el backend (ninguna línea para esa clave).
 */
export const AIU_INHERITED_REVENUE_MAPPING_KEY = 'invoice.validated.revenue';
export const AIU_INHERITED_VAT_MAPPING_KEY = 'invoice.validated.iva_payable';
export const AIU_INHERITED_VAT_LEGACY_MAPPING_KEY =
  'invoice.validated.vat_payable';

/** Los cinco huecos que pinta la sección AIU, cada uno con o sin herencia. */
export interface AiuInheritedAccountDefaults {
  revenue: Readonly<
    Record<'administracion' | 'imprevistos' | 'utilidad' | 'costo', InheritedAccountHint | null>
  >;
  vat: InheritedAccountHint | null;
}

export const EMPTY_AIU_INHERITED_DEFAULTS: AiuInheritedAccountDefaults = {
  revenue: {
    administracion: null,
    imprevistos: null,
    utilidad: null,
    costo: null,
  },
  vat: null,
};

/**
 * Proyección PURA de filas del endpoint a los cinco heredados. Exportada para
 * que la spec la pruebe sin HTTP (y poder correrla en Node con esbuild, igual
 * que el andamio de B.1).
 */
export function buildAiuInheritedDefaults(
  rows: readonly Pick<AccountMapping, 'mapping_key' | 'account_code' | 'description'>[] | null | undefined,
): AiuInheritedAccountDefaults {
  const byKey = new Map<string, InheritedAccountHint>();
  for (const row of rows ?? []) {
    const key = String(row?.mapping_key ?? '').trim();
    const code = String(row?.account_code ?? '').trim();
    if (!key || !code) continue;
    byKey.set(key, { code, name: String(row?.description ?? '').trim() });
  }
  // La primera clave que exista gana: es el mismo orden de precedencia que
  // `resolveTaxLines` corre en el backend (tipada antes que legacy).
  const pick = (
    ...keys: readonly string[]
  ): InheritedAccountHint | null => {
    for (const key of keys) {
      const hit = byKey.get(key);
      if (hit) return hit;
    }
    return null;
  };
  const revenue = pick(AIU_INHERITED_REVENUE_MAPPING_KEY);
  return {
    revenue: {
      administracion: revenue,
      imprevistos: revenue,
      utilidad: revenue,
      costo: revenue,
    },
    vat: pick(AIU_INHERITED_VAT_MAPPING_KEY, AIU_INHERITED_VAT_LEGACY_MAPPING_KEY),
  };
}

/** Filas del envelope estándar; tolera `data[]` y `data.items[]`. */
function extractRows(payload: unknown): AccountMapping[] {
  const data = (payload as { data?: unknown })?.data ?? payload;
  const items = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown })?.items)
      ? ((data as { items: unknown[] }).items as AccountMapping[])
      : [];
  return items.filter(
    (row): row is AccountMapping => !!row && typeof row === 'object',
  );
}

/**
 * De dónde salen los valores «heredados» que precargan VISUALMENTE los cinco
 * selectores de cuentas AIU (C.9, decisión híbrida).
 *
 * Lee UNA vez `GET /store/accounting/account-mappings` —la misma superficie que
 * Configuración → Contabilidad— y proyecta las claves que la emisión usa hoy.
 *
 * Dos garantías del contrato con la sección:
 * - **Nunca escribe controles.** Devuelve datos para PINTAR; el override sigue
 *   naciendo sólo del gesto del usuario sobre el selector.
 * - **Falla blando.** El endpoint exige permiso
 *   `store:accounting:account_mappings:read`; quien emite puede no tenerlo. Un
 *   403 o un corte de red degradan a «sin heredados» (placeholders como siempre)
 *   en vez de romper la pantalla de facturación. El error tampoco envenena la
 *   caché: se cachea la salida, nunca el fallo.
 */
@Injectable({ providedIn: 'root' })
export class AiuAccountDefaultsResolver {
  private readonly accounting = inject(AccountingService);
  private cached$: Observable<AiuInheritedAccountDefaults> | null = null;

  defaults(): Observable<AiuInheritedAccountDefaults> {
    this.cached$ ??= this.accounting.getAccountMappings().pipe(
      map((res) => buildAiuInheritedDefaults(extractRows(res))),
      catchError(() => of(EMPTY_AIU_INHERITED_DEFAULTS)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.cached$;
  }
}
