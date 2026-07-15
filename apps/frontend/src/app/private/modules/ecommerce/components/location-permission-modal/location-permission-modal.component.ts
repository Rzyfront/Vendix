import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

/**
 * Opt-in prompt shown the first time the customer reaches the shipping-address
 * section. Offers to use the device location to auto-fill the address. If the
 * customer declines (or dismisses), the manual form flow continues unchanged.
 *
 * Wraps the shared `app-modal`. Visibility is fully controlled by the parent
 * via `[(isOpen)]`; the component itself never displays coordinates.
 */
@Component({
  selector: 'app-location-permission-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './location-permission-modal.component.html',
  styleUrls: ['./location-permission-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocationPermissionModalComponent {
  readonly isOpen = input.required<boolean>();

  readonly isOpenChange = output<boolean>();
  readonly accept = output<void>();
  readonly decline = output<void>();

  onAccept(): void {
    this.accept.emit();
    this.isOpenChange.emit(false);
  }

  onDecline(): void {
    this.decline.emit();
    this.isOpenChange.emit(false);
  }
}
