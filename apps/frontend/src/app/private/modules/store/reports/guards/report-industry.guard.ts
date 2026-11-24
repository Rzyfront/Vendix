import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ReportCategoryId } from '../interfaces/report.interface';
import {
  isReportCategoryVisibleForIndustries,
  isReportVisibleForIndustries,
} from '../config/report-industries';
import { getReportById } from '../config/report-registry';

/** Destino cuando un enlace abre un reporte que no aplica a la tienda. */
export const REPORTS_FALLBACK_URL = '/admin/reports/overview';

/**
 * Agenda unificada F4: un enlace guardado a un reporte de otra industria
 * (p. ej. Hotelería en una tienda solo retail) vuelve al Resumen de Reportes
 * en lugar de abrir una página vacía que el backend responde con 403.
 *
 * Lee `data.categoryId` y/o `data.reportId` de la ruta. Si las industrias aún
 * no cargaron (lista vacía) deja pasar: esto es UX, la autorización está en el
 * backend, y suponer `retail` antes de saber expulsaría a un hotel al recargar.
 */
export const reportIndustryGuard: CanActivateFn = (route) => {
  const industries = inject(AuthFacade).storeIndustries();
  if (!industries.length) return true;

  const categoryId = route.data['categoryId'] as ReportCategoryId | undefined;
  if (categoryId && !isReportCategoryVisibleForIndustries(categoryId, industries)) {
    return inject(Router).parseUrl(REPORTS_FALLBACK_URL);
  }

  const reportId = route.data['reportId'] as string | undefined;
  const report = reportId ? getReportById(reportId) : undefined;
  if (report && !isReportVisibleForIndustries(report, industries)) {
    return inject(Router).parseUrl(REPORTS_FALLBACK_URL);
  }

  return true;
};
