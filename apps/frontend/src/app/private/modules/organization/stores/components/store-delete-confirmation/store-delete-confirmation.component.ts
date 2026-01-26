import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
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
    CommonModule,
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
  @Input() isOpen = false;
  @Input() store: StoreListItem | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

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
    return this.store ? `Escribe '${this.store.slug}' para confirmar` : '';
  }

  get isSlugValid(): boolean {
    if (!this.store || !this.slugInput.value) {
      return false;
    }
    return this.slugInput.value.trim() === this.store.slug;
  }

  showError = false;

  onConfirm(): void {
    if (!this.isSlugValid) {
      this.showError = true;
      return;
    }

    this.confirm.emit();
    this.slugInput.reset();
    this.showError = false;
  }

  onCancel(): void {
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
