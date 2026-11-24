import { inject } from '@angular/core';
import { Params, RedirectFunction, Router, UrlTree } from '@angular/router';

/** Categoría de Reportes que recibe los reportes de hotel (agenda unificada F4). */
export const HOSPITALITY_REPORTS_URL = '/admin/reports/hospitality';

/**
 * Pestaña de la vieja página «Reportes de hotel» (`?tab=`) y las URLs sueltas
 * previas a R4 (`/admin/hospitality/night-audit`…) → reporte en Reportes.
 */
export const HOSPITALITY_LEGACY_REPORT_SLUGS: Readonly<Record<string, string>> = {
  'night-audit': 'hotel-night-audit',
  performance: 'hotel-performance',
  pickup: 'hotel-pickup',
  cancellations: 'hotel-cancellations',
  fontur: 'hotel-fontur',
};

/** URL nueva de una pestaña vieja; sin pestaña (o desconocida) abre el catálogo. */
export function hospitalityLegacyReportUrl(tab: string | null | undefined): string {
  const slug = tab ? HOSPITALITY_LEGACY_REPORT_SLUGS[tab] : undefined;
  return slug ? `${HOSPITALITY_REPORTS_URL}/${slug}` : HOSPITALITY_REPORTS_URL;
}

/**
 * `redirectTo` de `/admin/hospitality/reports`: conserva la pestaña pedida
 * (`?tab=`) y el resto de query params (rango de fechas, etc.).
 */
export const hospitalityReportsLegacyRedirect: RedirectFunction = ({ queryParams }) =>
  buildRedirect(queryParams['tab'], queryParams);

/** `redirectTo` de una URL suelta vieja (`/admin/hospitality/<tab>`). */
export function hospitalityLegacyTabRedirect(tab: string): RedirectFunction {
  return ({ queryParams }) => buildRedirect(tab, queryParams);
}

function buildRedirect(tab: string | undefined, queryParams: Params): UrlTree {
  const rest: Params = { ...queryParams };
  delete rest['tab'];
  return inject(Router).createUrlTree([hospitalityLegacyReportUrl(tab)], {
    queryParams: rest,
  });
}
