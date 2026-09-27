import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

/**
 * Fallback shown when the buyer's address could not be located on the map
 * (no coordinates resolved) and the checkout needs another way to capture
 * the delivery point. Offers to continue the order over WhatsApp instead of
 * forcing the buyer to keep fighting the map picker.
 *
 * Wraps the shared `app-modal`, mirroring the visual language of
 * `LocationPermissionModalComponent` (hero band + icon halo + stacked
 * full-width actions) but themed around the WhatsApp brand.
 *
 * `loading()` reflects an in-flight action owned by the parent (e.g.
 * building the WhatsApp deep link); the modal stays open while it is true
 * and the primary button shows its own disabled/spinner state. The parent
 * decides when to close it (`isOpen.set(false)`) once that action settles.
 */
@Component({
  selector: 'app-whatsapp-fallback-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './whatsapp-fallback-modal.component.html',
  styleUrl: './whatsapp-fallback-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappFallbackModalComponent {
  readonly isOpen = model<boolean>(false);
  readonly loading = input<boolean>(false);

  readonly confirm = output<void>();
  readonly decline = output<void>();

  onConfirm(): void {
    this.confirm.emit();
  }

  onDecline(): void {
    this.decline.emit();
    this.isOpen.set(false);
  }
}
