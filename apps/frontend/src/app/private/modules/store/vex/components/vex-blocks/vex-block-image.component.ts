import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure
      class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden m-0"
    >
      @if (url()) {
        <img
          [src]="url()"
          [alt]="spec().alt || 'Imagen generada por Vex'"
          class="w-full max-h-96 object-contain bg-[var(--color-background)]"
          loading="lazy"
        />
      } @else {
        <p class="px-4 py-6 text-sm text-center text-[var(--color-text-secondary)]">
          La imagen expiró o aún no está disponible. Pídele a Vex que la regenere.
        </p>
      }
      @if (spec().caption) {
        <figcaption class="px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          {{ spec().caption }}
        </figcaption>
      }
    </figure>
  `,
})
export class VexBlockImageComponent {
  readonly block = input.required<VexUiBlock>();

  readonly spec = computed(() => this.block().spec as VexImageSpec);

  readonly url = computed(() => {
    const url = this.block().data['url'];
    return typeof url === 'string' && url ? url : '';
  });
}
