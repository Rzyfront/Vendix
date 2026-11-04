import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { ProductPageViewComponent } from '../../../../../public/product-page/product-page-view.component';
import { ServicePageHomeViewComponent } from '../../../../../public/service-page/service-page-home-view.component';
import { ServicePageViewComponent } from '../../../../../public/service-page/service-page-view.component';
import { StoreHomeViewComponent } from '../../../../../public/store-home/store-home-view.component';
import { BUILDER_PREVIEW_CHANNEL, readFrameMessage } from '../builder/builder-preview';
import type { PageAppKind } from '../templates';
import type { AppPagePreviewPayload } from './page-builder.types';
import { ProductPageContext, ProductPageSettings, productPagePreview } from './product-page/product-page-builder';
import { ProductPagePreviewBodyComponent } from './product-page/product-page-preview-body.component';
import { ServicePageContext, ServicePageSettings, servicePagePreview } from './service-page/service-page-builder';
import { StoreHomeContext, StoreHomeSettings, storeHomePreview } from './store-home/store-home-builder';

/** Outline of the section selected in the editor. */
const SELECTED_STYLE = `[data-preview-selected="true"]{outline:2px solid var(--color-primary,#2563eb);outline-offset:-2px;}
[data-block-id]{cursor:pointer;}`;

/**
 * F6-B — `/admin/apps/page-preview/:kind`, loaded only inside the app page
 * builder's preview iframe. It renders the app's public page with the SAME
 * components the published page uses, from the draft and the real store data
 * the editor posts. It fetches nothing. Links never navigate here; a click on
 * a section (`data-block-id`) selects it in the editor.
 */
@Component({
  selector: 'app-app-page-preview-frame',
  standalone: true,
  imports: [StoreHomeViewComponent, ProductPageViewComponent, ProductPagePreviewBodyComponent, ServicePageViewComponent, ServicePageHomeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (payload(); as p) {
      @switch (p.kind) {
        @case ('store_home') {
          <app-store-home-view [home]="storeHome()" [fallback]="fallback()" [blockIds]="true" />
        }
        @case ('product_page') {
          @if (productPage(); as view) {
            <app-product-page-view [page]="view.page" [storeName]="view.storeName || 'Tienda'" [storeLogo]="view.storeLogoUrl" [blockIds]="true">
              <app-product-page-preview-body [preview]="view" />
            </app-product-page-view>
          }
        }
        @case ('service_page') {
          @if (servicePage(); as view) {
            <app-service-page-view [page]="view.page" [storeName]="view.storeName || 'Tienda'" [storeLogo]="view.storeLogoUrl">
              <app-service-page-home-view
                [services]="view.services"
                [featuredIds]="view.featuredIds"
                [productIds]="view.productIds"
                [page]="view.page"
                [storeName]="view.storeName"
                [previewProducts]="view.products"
                [blockIds]="true"
              />
            </app-service-page-view>
          }
        }
      }
    }
  `,
})
export class AppPagePreviewFrameComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly view = this.doc.defaultView;
  /** The editor window; `null` when the route is opened outside the iframe. */
  private readonly parent = this.view && this.view.parent !== this.view ? this.view.parent : null;
  private readonly origin = this.view?.location.origin ?? '';

  /** Route param: the app this frame paints (messages of another app are ignored). */
  readonly kind = (inject(ActivatedRoute).snapshot.paramMap.get('kind') ?? null) as PageAppKind | null;
  readonly payload = signal<AppPagePreviewPayload | null>(null);
  readonly selectedBlockId = signal<string | null>(null);

  readonly fallback = computed(() => {
    const p = this.payload();
    return { name: p?.storeName || null, slug: null, logoUrl: p?.storeLogoUrl ?? null, primaryColor: null };
  });
  readonly storeHome = computed(() => {
    const p = this.payload();
    return p?.kind === 'store_home'
      ? storeHomePreview(p as AppPagePreviewPayload<StoreHomeSettings | null, StoreHomeContext | null>)
      : null;
  });

  readonly productPage = computed(() => {
    const p = this.payload();
    return p?.kind === 'product_page'
      ? productPagePreview(p as AppPagePreviewPayload<ProductPageSettings | null, ProductPageContext | null>)
      : null;
  });

  readonly servicePage = computed(() => {
    const p = this.payload();
    return p?.kind === 'service_page'
      ? servicePagePreview(p as AppPagePreviewPayload<ServicePageSettings | null, ServicePageContext | null>)
      : null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const view = this.view;

    const style = this.doc.createElement('style');
    style.textContent = SELECTED_STYLE;
    this.doc.head.appendChild(style);

    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage<AppPagePreviewPayload>(event, this.origin, this.parent);
      if (!message) return;
      if (this.kind && message.payload?.kind !== this.kind) return;
      this.payload.set(message.payload);
      this.selectedBlockId.set(message.selectedBlockId);
    };
    // The preview is a picture of the page: links and buttons never leave it;
    // a click on a section selects it in the editor.
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('a[href], button, form')) event.preventDefault();
      const section = target?.closest?.('[data-block-id]');
      const id = section?.getAttribute('data-block-id');
      if (id) this.select(id);
    };
    const onSubmit = (event: Event) => event.preventDefault();
    view?.addEventListener('message', onMessage);
    this.doc.addEventListener('click', onClick, true);
    this.doc.addEventListener('submit', onSubmit, true);
    destroyRef.onDestroy(() => {
      view?.removeEventListener('message', onMessage);
      this.doc.removeEventListener('click', onClick, true);
      this.doc.removeEventListener('submit', onSubmit, true);
      style.remove();
    });

    this.parent?.postMessage({ channel: BUILDER_PREVIEW_CHANNEL, type: 'ready' }, this.origin);

    // Mark the section selected in the editor (again after each render) and
    // bring it into view only when the selection changes.
    let scrolledTo: string | null = null;
    effect(() => {
      const id = this.selectedBlockId();
      this.payload();
      untracked(() =>
        queueMicrotask(() => {
          this.doc.querySelectorAll('[data-preview-selected]').forEach((el) => el.removeAttribute('data-preview-selected'));
          if (!id) return;
          const el = this.doc.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
          el?.setAttribute('data-preview-selected', 'true');
          if (el && scrolledTo !== id) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          scrolledTo = id;
        }),
      );
    });
  }

  select(blockId: string): void {
    this.selectedBlockId.set(blockId);
    this.parent?.postMessage({ channel: BUILDER_PREVIEW_CHANNEL, type: 'select', blockId }, this.origin);
  }
}
