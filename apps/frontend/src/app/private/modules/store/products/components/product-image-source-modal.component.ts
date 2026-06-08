import { Component, computed, input, model, output } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ImageSourceModalComponent } from '../../../../../shared/components';

type ImageModalMode = 'add' | 'edit';
type ImageTarget = 'product' | 'variant';

/**
 * Wrapper delgado sobre `app-image-source-modal` (compartido).
 *
 * Mantiene la API pública histórica (`target`, `allowAiEnhance`, etc.) para no
 * tocar a sus consumidores (product-create-page, brand-form-modal,
 * category-form-modal). Toda la lógica de crop/canvas/URL/cámara vive ahora en
 * el componente compartido; aquí solo se hace passthrough de inputs/outputs.
 *
 * - `target === 'variant'` se mapea a `singleImage` del compartido.
 * - `allowAiEnhance` se mapea a la presencia de un `aiEnhanceHandler` (la tarjeta
 *   de IA del compartido solo se muestra cuando hay handler). El handler es un
 *   no-op (`of(dataUrl)`) porque la funcionalidad sigue siendo un placeholder
 *   deshabilitado.
 */
@Component({
  selector: 'app-product-image-source-modal',
  standalone: true,
  imports: [ImageSourceModalComponent],
  template: `
    <app-image-source-modal
      [(isOpen)]="isOpen"
      [singleImage]="target() === 'variant'"
      [remainingSlots]="remainingSlots()"
      [mode]="mode()"
      [sourceImageUrl]="sourceImageUrl()"
      [aiEnhanceHandler]="enhanceHandler()"
      (imagesAdded)="imagesAdded.emit($event)"
      (imageEdited)="imageEdited.emit($event)"
    ></app-image-source-modal>
  `,
})
export class ProductImageSourceModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly target = input<ImageTarget>('product');
  readonly remainingSlots = input<number>(5);
  readonly mode = input<ImageModalMode>('add');
  readonly allowAiEnhance = input<boolean>(true);
  readonly sourceImageUrl = input<string | null>(null);
  readonly imagesAdded = output<string[]>();
  readonly imageEdited = output<string>();

  private readonly noopEnhance = (dataUrl: string): Observable<string> =>
    of(dataUrl);

  readonly enhanceHandler = computed<
    ((dataUrl: string) => Observable<string>) | null
  >(() => (this.allowAiEnhance() ? this.noopEnhance : null));
}
