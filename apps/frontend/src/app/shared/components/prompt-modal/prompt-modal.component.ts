import { Component, OnInit, model, input, output } from '@angular/core';

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
export class PromptModalComponent implements OnInit {
  readonly title = input('Ingresar valor');
  readonly message = input('');
  readonly placeholder = input('');
  readonly defaultValue = input('');
  readonly confirmText = input('Aceptar');
  readonly cancelText = input('Cancelar');
  readonly size = input<'sm' | 'md' | 'lg'>('sm');
  readonly showCloseButton = input(true);
  readonly customClasses = input('');
  readonly inputType = input<'text' | 'number'>('text');
  readonly isOpen = model(true);

  readonly confirm = output<string>();
  readonly cancel = output<void>();

  inputValue = '';

  ngOnInit(): void {
    // Prefill con defaultValue (lo setea DialogService.prompt vía setInput antes
    // del primer change detection). El template usa [(ngModel)]="inputValue", que
    // antes ignoraba defaultValue y dejaba el campo siempre vacío.
    this.inputValue = this.defaultValue();
  }

  onConfirm(): void {
    this.confirm.emit(this.inputValue);
    this.isOpen.set(false);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpen.set(false);
  }
}
