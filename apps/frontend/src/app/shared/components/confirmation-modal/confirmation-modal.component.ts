import { Component, Input, output } from '@angular/core';

import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  templateUrl: './confirmation-modal.component.html',
  styleUrl: './confirmation-modal.component.scss',
})
export class ConfirmationModalComponent {
  @Input() title = 'Confirmación';
  @Input() message = '¿Estás seguro?';
  @Input() confirmText = 'Aceptar';
  @Input() cancelText = 'Cancelar';
  @Input() confirmVariant: 'primary' | 'danger' = 'primary';
  @Input() size: 'sm' | 'md' | 'lg' = 'sm';
  @Input() showCloseButton = true;
  @Input() customClasses = '';

  readonly confirm = output<void>();
  readonly cancel = output<void>();
  readonly isOpenChange = output<boolean>();

  @Input() isOpen = true;

  onConfirm(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.confirm.emit();
    this.isOpenChange.emit(false);
  }

  onCancel(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.cancel.emit();
    this.isOpenChange.emit(false);
  }
}
