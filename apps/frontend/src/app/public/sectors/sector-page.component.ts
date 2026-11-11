import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { applyMarketingPageMetadata } from '../marketing-page-metadata';
import { SectorPageContent, sectorPageByPath, sectorWhatsappUrl } from './sector-pages.content';

/**
 * Plantilla de página de sector o solución (SEO-TECH-08, SEO-OPS-17). Todo el texto viene
 * de `sector-pages.content.ts`; la ruta pasa la clave en `data.sectorPath`.
 */
@Component({
  selector: 'app-sector-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sector-page.component.html',
  styleUrls: ['../landing/guides/sector-guide.component.scss', './sector-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectorPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });

  readonly page = computed<SectorPageContent | null>(() => sectorPageByPath(String(this.data()['sectorPath'] ?? '')));
  readonly whatsappUrl = computed(() => {
    const page = this.page();
    return page ? sectorWhatsappUrl(page) : null;
  });

  constructor() {
    const page = sectorPageByPath(String(this.route.snapshot.data['sectorPath'] ?? ''));
    if (page) {
      const restore = applyMarketingPageMetadata(inject(DOCUMENT), inject(Title), inject(Meta), page.metadata);
      inject(DestroyRef).onDestroy(restore);
    }
  }
}
