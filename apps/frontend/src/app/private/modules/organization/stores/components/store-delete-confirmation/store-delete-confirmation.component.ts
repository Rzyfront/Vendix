import { Component, OnDestroy, input, output, model } from '@angular/core';

import {
  FormsModule,
  ReactiveFormsModule,
  FormControl,
  Validators,
} from '@angular/forms';
import { Subject } from 'rxjs';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

import { StoreListItem } from '../../interfaces/store.interface';

@Component({
  selector: 'app-store-delete-confirmation',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './store-delete-confirmation.component.html',
  styleUrl: './store-delete-confirmation.component.scss',
})
export class StoreDeleteConfirmationComponent implements OnDestroy {
  readonly isOpen = model<boolean>(false);
  readonly store = input<StoreListItem | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  slugInput = new FormControl('', {
    validators: [Validators.required],
    nonNullable: true,
  });

  private destroy$ = new Subject<void>();

  constructor() {
    this.slugInput.valueChanges.subscribe(() => {
      if (this.showError && this.isSlugValid) {
        this.showError = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get placeholderText(): string {
    const store = this.store();
    return store ? `Escribe '${store.slug}' para confirmar` : '';
  }

  get isSlugValid(): boolean {
    const store = this.store();
    if (!store || !this.slugInput.value) {
      return false;
    }
    return this.slugInput.value.trim() === store.slug;
  }

  showError = false;

  onConfirm(): void {
    if (!this.isSlugValid) {
      this.showError = true;
      return;
    }

    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    this.confirm.emit();
    this.slugInput.reset();
    this.showError = false;
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
    this.cancel.emit();
    this.slugInput.reset();
    this.showError = false;
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.slugInput.reset();
      this.showError = false;
    }
  }
}
