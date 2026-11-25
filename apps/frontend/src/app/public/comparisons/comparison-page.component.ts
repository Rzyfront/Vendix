import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata } from '../marketing-page-metadata';
import {
  COMPARISON_PAGE_INDEXABLE,
  COMPARISON_PAGE_PATH,
  COMPARISON_PRICES_CHECKED_AT,
} from './comparison-page.config';
import { COMPARISON_CAVEATS, COMPARISON_METHOD, COMPARISON_ROWS } from './comparison-page.content';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** «2026-11-19» → «19 de noviembre de 2026», sin depender de la zona horaria del navegador. */
export function formatCheckedAt(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

/**
 * SEO-OPS-30: «Software POS con facturación electrónica en Colombia: cómo se comparan los planes».
 * Borrador del 5-nov (entregas/2026-11-05/OPS-30-pagina-comparativa-borrador.md) con los precios
 * revalidados el 19-nov. Ruta detrás de COMPARISON_PAGE_ENABLED; noindex hasta la firma.
 */
@Component({
  selector: 'app-comparison-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './comparison-page.component.html',
  styleUrls: ['../landing/guides/sector-guide.component.scss', './comparison-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonPageComponent {
  private readonly restoreMarketingMetadata = applyMarketingPageMetadata(
    inject(DOCUMENT),
    inject(Title),
    inject(Meta),
    {
      title: 'Software POS con facturación electrónica en Colombia: comparativa de planes | Vendix',
      description:
        'Comparamos planes de software POS con facturación electrónica DIAN en Colombia: precio publicado, facturas incluidas, bodegas, restaurante y prueba gratis. Datos de las webs oficiales.',
      robots: COMPARISON_PAGE_INDEXABLE ? 'index, follow' : 'noindex, follow',
      canonicalPath: `/${COMPARISON_PAGE_PATH}`,
    },
  );
  private readonly marketingMetadataCleanup = inject(DestroyRef).onDestroy(
    this.restoreMarketingMetadata,
  );

  readonly published = COMPARISON_PAGE_INDEXABLE;
  readonly checkedAt = formatCheckedAt(COMPARISON_PRICES_CHECKED_AT);
  readonly rows = COMPARISON_ROWS;
  readonly method = COMPARISON_METHOD;
  readonly caveats = COMPARISON_CAVEATS;
}
