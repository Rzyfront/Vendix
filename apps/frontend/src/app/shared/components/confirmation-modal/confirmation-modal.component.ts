import { Component, model, input, output } from '@angular/core';

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
  readonly title = input('Confirmación');
  readonly message = input('¿Estás seguro?');
  readonly confirmText = input('Aceptar');
  readonly cancelText = input('Cancelar');
  readonly confirmVariant = input<'primary' | 'danger'>('primary');
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly showCloseButton = input(true);
  readonly customClasses = input('');

  readonly confirm = output<void>();
  readonly cancel = output<void>();

  readonly isOpen = model(true);

  onConfirm(): void {
    this.confirm.emit();
    this.isOpen.set(false);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpen.set(false);
  }
}
