import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ImageLightboxComponent } from '../../../../../../shared/components/image-lightbox/image-lightbox.component';
import { VEX_COPY } from '../../vex-copy';
import { VexImageSpec, VexUiBlock } from '../../models/vex.models';

/**
 * Renders an `image` block Vex generated or attached.
 *
 * The URL is a short-lived signed read URL the backend minted for this turn —
 * it is rendered, never persisted. When the backend only sends the S3 key,
 * the image cannot render and the caption explains why instead of showing a
 * broken tile.
 */
@Component({
  selector: 'vendix-vex-block-image',
  standalone: true,
  imports: [ImageLightboxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure
      class="rounded-2xl border border-border bg-surface overflow-hidden m-0"
    >
      @if (url()) {
        <button
          type="button"
          class="block w-full cursor-zoom-in"
          [attr.aria-label]="'Ampliar imagen: ' + (spec().alt || copy.alt)"
          (click)="lightbox_open.set(true)"
        >
          <img
            [src]="url()"
            [alt]="spec().alt || copy.alt"
            class="w-full max-h-96 object-contain bg-background"
            loading="lazy"
          />
        </button>
        <app-image-lightbox
          [isOpen]="lightbox_open()"
          [currentImage]="url()"
          [alt]="spec().alt || copy.alt"
          [title]="spec().caption"
          (close)="lightbox_open.set(false)"
        />
      } @else {
        <p class="px-4 py-6 text-sm text-center text-text-secondary">
          {{ copy.unavailable }}
        </p>
      }
      @if (spec().caption) {
        <figcaption class="px-4 py-2 text-xs text-text-secondary">
          {{ spec().caption }}
        </figcaption>
      }
    </figure>
  `,
})
export class VexBlockImageComponent {
  protected readonly copy = VEX_COPY.blocks.image;
  readonly block = input.required<VexUiBlock>();

  readonly lightbox_open = signal(false);

  readonly spec = computed(() => this.block().spec as VexImageSpec);

  readonly url = computed(() => {
    const url = this.block().data['url'];
    return typeof url === 'string' && url ? url : '';
  });
}
