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
  readonly guide = computed(
    () => SECTOR_GUIDES[this.data()['guideKey']] ?? null,
  );

  constructor() {
    afterRenderEffect(() => {
      const fragment = this.fragment();
      if (fragment) this.scroller.scrollToAnchor(fragment);
    });
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
