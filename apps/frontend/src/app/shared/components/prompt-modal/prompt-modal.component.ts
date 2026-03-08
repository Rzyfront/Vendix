import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { ButtonComponent } from '../button/button.component';
import { InputComponent } from '../input/input.component';

@Component({
  selector: 'app-prompt-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, ButtonComponent, InputComponent],
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

  @Output() confirm = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();
  @Output() isOpenChange = new EventEmitter<boolean>();

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
    this.cancel.emit();
    this.isOpenChange.emit(false);
  }
}
