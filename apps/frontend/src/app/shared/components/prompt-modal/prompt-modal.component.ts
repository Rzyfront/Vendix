import { Component, Input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { InputComponent } from '../input/input.component';

@Component({
  selector: 'app-prompt-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  templateUrl: './prompt-modal.component.html',
  styleUrl: './prompt-modal.component.scss',
})
export class PromptModalComponent {
  @Input() title = 'Ingresar valor';
  @Input() message = '';
  @Input() placeholder = '';
  @Input() defaultValue = '';
  @Input() confirmText = 'Aceptar';
  @Input() cancelText = 'Cancelar';
  @Input() size: 'sm' | 'md' | 'lg' = 'sm';
  @Input() showCloseButton = true;
  @Input() customClasses = '';

  readonly confirm = output<string>();
  readonly cancel = output<void>();
  readonly isOpenChange = output<boolean>();

  @Input() inputType: 'text' | 'number' = 'text';
  @Input() isOpen = true;
  inputValue = '';

  ngOnInit(): void {
    this.inputValue = this.defaultValue;
  }

  onConfirm(): void {
    this.confirm.emit(this.inputValue);
    this.isOpenChange.emit(false);
  }

  onCancel(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.cancel.emit();
    this.isOpenChange.emit(false);
  }
}
