import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
} from '@angular/core';
import { DOCUMENT, ViewportScroller } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { SECTOR_GUIDES } from './sector-guides.content';
import {
  ROUTED_SECTOR_GUIDES,
  SECTOR_GUIDES_ENABLED,
  isPublishedSectorGuide,
} from './sector-guides.config';
import { applyMarketingPageMetadata } from '../../marketing-page-metadata';

/** Enlaces del bloque «Sigue preparando tu operación», en este orden. */
const RELATED_GUIDES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'comandas-restaurantes', label: 'Comandas para restaurantes' },
  { key: 'ventas-mayoristas-al-detal', label: 'Ventas mayoristas y al detal' },
  { key: 'pasar-productos-excel-a-pos', label: 'Pasar tus productos de Excel a un POS' },
  { key: 'preparar-demostracion', label: 'Preparar una demostración' },
  { key: 'cierre-de-caja', label: 'Cierre de caja diario' },
  { key: 'control-de-inventario', label: 'Control de inventario' },
  { key: 'elegir-software-pos', label: 'Cómo elegir un software POS' },
];

@Component({
  selector: 'app-sector-guide',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sector-guide.component.html',
  styleUrl: './sector-guide.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectorGuideComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly scroller = inject(ViewportScroller);
  private readonly data = toSignal(this.route.data, {
    initialValue: this.route.snapshot.data,
  });
  private readonly fragment = toSignal(this.route.fragment, {
    initialValue: this.route.snapshot.fragment,
  });
  private readonly guideKey = computed(() => String(this.data()['guideKey'] ?? ''));
  readonly guide = computed(() => SECTOR_GUIDES[this.guideKey()] ?? null);
  /** SEO-OPS-36: guía aprobada y servida en producción (indexable, sin rótulo de borrador). */
  readonly published = computed(() => isPublishedSectorGuide(this.guideKey()));
  /** La sección de guías de la portada solo existe en vista previa. */
  readonly guidesIndexAvailable = SECTOR_GUIDES_ENABLED;
  /** Solo enlaza guías con ruta, nunca la actual. */
  readonly relatedGuides = computed(() =>
    RELATED_GUIDES.filter(
      (item) => item.key !== this.guideKey() && ROUTED_SECTOR_GUIDES.includes(item.key),
    ),
  );

  constructor() {
    afterRenderEffect(() => {
      const fragment = this.fragment();
      if (fragment) this.scroller.scrollToAnchor(fragment);
    });
    // Guía publicada: metadatos de página comercial (index, canonical propio, OG) solo
    // en el host comercial; se restauran al salir (SEO-OPS-36).
    if (isPublishedSectorGuide(String(this.route.snapshot.data['guideKey'] ?? ''))) {
      effect((onCleanup) => {
        const guide = this.guide();
        if (!guide) return;
        onCleanup(
          applyMarketingPageMetadata(this.document, this.title, this.meta, {
            title: `${guide.title} | Vendix`,
            description: guide.description,
            robots: 'index, follow',
            canonicalPath: `/guias/${this.guideKey()}`,
          }),
        );
      });
      return;
    }
    const previousTitle = this.title.getTitle();
    const previousDescription = this.meta.getTag('name="description"')?.content;
    const previousRobots = this.meta.getTag('name="robots"')?.content;
    const canonical = this.document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    const previousCanonical = canonical?.getAttribute('href');
    // Preview pages are deliberately noindex; do not leave the home's canonical
    // on a distinct article. Publication needs its own HTTP/metadata review.
    canonical?.removeAttribute('href');
    effect(() => {
      const guide = this.guide();
      this.title.setTitle(
        guide ? `${guide.title} | Vendix` : 'Guía no disponible | Vendix',
      );
      this.meta.updateTag({
        name: 'description',
        content:
          guide?.description ??
          'Consulta las guías disponibles para tu operación.',
      });
      this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    });
    inject(DestroyRef).onDestroy(() => {
      this.title.setTitle(previousTitle);
      if (previousDescription !== undefined)
        this.meta.updateTag({
          name: 'description',
          content: previousDescription,
        });
      else this.meta.removeTag('name="description"');
      if (previousRobots !== undefined)
        this.meta.updateTag({ name: 'robots', content: previousRobots });
      else this.meta.removeTag('name="robots"');
      if (
        canonical &&
        previousCanonical !== null &&
        previousCanonical !== undefined
      )
        canonical.setAttribute('href', previousCanonical);
    });
  }
}
