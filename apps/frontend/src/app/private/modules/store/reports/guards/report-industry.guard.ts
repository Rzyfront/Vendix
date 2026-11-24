import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ReportCategoryId } from '../interfaces/report.interface';
import {
  isReportCategoryAllowedForPanel,
  isReportCategoryVisibleForIndustries,
  isReportVisibleForIndustries,
} from '../config/report-industries';
import { getReportById } from '../config/report-registry';

/** Destino cuando un enlace abre un reporte que no aplica a la tienda o al rol. */
export const REPORTS_FALLBACK_URL = '/admin/reports/overview';

/**
 * Agenda unificada F4: un enlace guardado a un reporte de otra industria
 * (p. ej. Hotelería en una tienda solo retail) o de una categoría cuya key de
 * panel el rol no tiene (Hotelería sin `hospitality_reservations`) vuelve al
 * Resumen de Reportes en lugar de abrir una página que el backend responde
 * con 403.
 *
 * Lee `data.categoryId` y/o `data.reportId` de la ruta. Es UX: la autorización
 * está en el backend.
 *   - Industrias: mientras los ajustes de la tienda no cargan y el login no
 *     trajo industrias, deja pasar (suponer `retail` antes de saber expulsaría a
 *     un hotel al recargar). Con los ajustes cargados, una tienda sin
 *     industrias se lee como `retail`, igual que el catálogo y el menú.
 *   - Panel: solo decide cuando el panel del usuario ya cargó (alguna key
 *     visible); el owner no se filtra.
 */
export const reportIndustryGuard: CanActivateFn = (route) => {
  const auth = inject(AuthFacade);
  const industries = auth.storeIndustries();
  const industriesKnown = industries.length > 0 || auth.storeSettings() != null;

  const categoryId = route.data['categoryId'] as ReportCategoryId | undefined;
  const reportId = route.data['reportId'] as string | undefined;
  const report = reportId ? getReportById(reportId) : undefined;

  if (industriesKnown) {
    if (categoryId && !isReportCategoryVisibleForIndustries(categoryId, industries)) {
      return inject(Router).parseUrl(REPORTS_FALLBACK_URL);
    }
    if (report && !isReportVisibleForIndustries(report, industries)) {
      return inject(Router).parseUrl(REPORTS_FALLBACK_URL);
    }
  }

  const visibleModules = auth.visibleModules();
  const panelCategory = categoryId ?? report?.category;
  if (panelCategory && visibleModules.length > 0) {
    const access = { isOwner: auth.isOwner(), visibleModules };
    if (!isReportCategoryAllowedForPanel(panelCategory, access)) {
      return inject(Router).parseUrl(REPORTS_FALLBACK_URL);
    }
  }

  return true;
};
