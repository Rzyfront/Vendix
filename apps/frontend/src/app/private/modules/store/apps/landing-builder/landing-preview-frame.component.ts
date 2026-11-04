import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { LandingDocumentViewComponent } from '../../../../../public/dynamic-landing/components/landing-document-view/landing-document-view.component';
import {
  landingLogo,
  visibleBlocks,
} from '../../../../../public/dynamic-landing/components/landing-document-view/landing-view.util';
import { LandingLayoutComponent } from '../../../../../shared/components/layouts/landing-layout/landing-layout.component';
import { BUILDER_PREVIEW_CHANNEL, readFrameMessage } from '../builder/builder-preview';
import { LandingPreviewPayload, withPreviewProducts } from './landing-preview';

/**
 * F6-A — `/admin/apps/landing/preview-frame`, loaded only inside the landing
 * editor's preview iframe. It renders the public landing with the SAME
 * components the published page uses (`LandingLayoutComponent` +
 * `LandingDocumentViewComponent`) from the draft the editor posts. It fetches
 * nothing: everything arrives in the message. Links never navigate here.
 */
@Component({
  selector: 'app-landing-preview-frame',
  standalone: true,
  imports: [LandingLayoutComponent, LandingDocumentViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (payload(); as p) {
      <app-landing-layout [brandName]="p.storeName" [logoUrl]="logo()">
        @if (empty()) {
          <section class="mx-auto my-16 max-w-md rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center text-slate-500">
            <p class="text-base font-semibold text-slate-700">Tu página aún no tiene secciones visibles</p>
            <p class="mt-1 text-sm">Agrega una desde «Agregar sección» o muestra una oculta.</p>
          </section>
        }
        <app-landing-document-view
          [document]="document()!"
          [ecommerceBaseUrl]="p.context.ecommerce_base_url"
          [offer]="p.offer"
          [preview]="true"
          [selectedBlockId]="selectedBlockId()"
          (blockSelect)="select($event)"
        />
      </app-landing-layout>
    }
  `,
})
export class LandingPreviewFrameComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly view = this.doc.defaultView;
  /** The editor window; `null` when the route is opened outside the iframe. */
  private readonly parent = this.view && this.view.parent !== this.view ? this.view.parent : null;
  private readonly origin = this.view?.location.origin ?? '';

  readonly payload = signal<LandingPreviewPayload | null>(null);
  readonly selectedBlockId = signal<string | null>(null);

  readonly document = computed(() => {
    const p = this.payload();
    return p ? withPreviewProducts(p.document, p.context.products) : null;
  });
  readonly empty = computed(() => visibleBlocks(this.document()).length === 0);
  readonly logo = computed(() => landingLogo(this.document()) ?? this.payload()?.storeLogoUrl ?? undefined);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const view = this.view;

    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage<LandingPreviewPayload>(event, this.origin, this.parent);
      if (!message) return;
      this.payload.set(message.payload);
      this.selectedBlockId.set(message.selectedBlockId);
    };
    // The preview is a picture of the page: links and buttons never leave it.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
      if (anchor) event.preventDefault();
    };
    view?.addEventListener('message', onMessage);
    this.doc.addEventListener('click', onClick, true);
    destroyRef.onDestroy(() => {
      view?.removeEventListener('message', onMessage);
      this.doc.removeEventListener('click', onClick, true);
    });

    this.parent?.postMessage({ channel: BUILDER_PREVIEW_CHANNEL, type: 'ready' }, this.origin);

    // Bring the section selected in the editor into view.
    effect(() => {
      const id = this.selectedBlockId();
      if (!id) return;
      untracked(() =>
        queueMicrotask(() =>
          this.doc
            .querySelector(`[data-block-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
        ),
      );
    });
  }

  /** A click in the frame selects the section in the editor. */
  select(blockId: string): void {
    this.selectedBlockId.set(blockId);
    this.parent?.postMessage({ channel: BUILDER_PREVIEW_CHANNEL, type: 'select', blockId }, this.origin);
  }
}
