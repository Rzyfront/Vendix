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
import { InputComponent } from '../../../../../../shared/components/input/input.component';

import { Domain } from '../../interfaces/domain.interface';

@Component({
  selector: 'app-domain-delete-confirmation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="onCancel()"
      [size]="'sm'"
      title="Eliminar Dominio"
    >
      <div class="space-y-4">
        <!-- Warning Icon -->
        <div class="flex justify-center">
          <div
            class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center"
          >
            <app-icon
              name="alert-triangle"
              [size]="32"
              class="text-red-600"
            ></app-icon>
          </div>
        </div>

        <!-- Warning Message -->
        <div class="text-center">
          <p class="text-[var(--color-text-primary)] font-medium mb-2">
            ¿Estás seguro de eliminar este dominio?
          </p>
          <p class="text-sm text-[var(--color-text-secondary)]">
            Esta acción no se puede deshacer. El dominio
            <strong class="text-[var(--color-text-primary)]">{{
              domain?.hostname
            }}</strong>
            será eliminado permanentemente.
          </p>
        </div>

        <!-- Primary Domain Warning -->
        <div
          *ngIf="domain?.is_primary"
          class="bg-yellow-50 border border-yellow-200 rounded-lg p-3"
        >
          <div class="flex items-start gap-2">
            <app-icon
              name="alert-circle"
              [size]="16"
              class="text-yellow-600 mt-0.5"
            ></app-icon>
            <p class="text-sm text-yellow-800">
              Este es un dominio primario. Elimínarlo puede afectar el acceso a
              tu tienda u organización.
            </p>
          </div>
        </div>

        <!-- Confirmation Input -->
        <div class="space-y-2">
          <label
            class="block text-sm font-medium text-[var(--color-text-primary)]"
          >
            Escribe
            <strong class="text-[var(--color-destructive)]">{{
              domain?.hostname
            }}</strong>
            para confirmar
          </label>
          <app-input
            [formControl]="hostnameInput"
            [placeholder]="placeholderText"
            size="md"
            [error]="showError ? 'El hostname no coincide' : ''"
          >
            <app-icon name="globe" [size]="16" slot="prefix" />
          </app-input>
        </div>
      </div>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          (clicked)="onConfirm()"
          [disabled]="!isHostnameValid"
        >
          <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
          Eliminar Dominio
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class DomainDeleteConfirmationComponent implements OnDestroy {
  @Input() isOpen = false;
  @Input() domain: Domain | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() confirm = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  hostnameInput = new FormControl('', {
    validators: [Validators.required],
    nonNullable: true,
  });

  showError = false;

  private destroy$ = new Subject<void>();

  constructor() {
    this.hostnameInput.valueChanges.subscribe(() => {
      if (this.showError && this.isHostnameValid) {
        this.showError = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get placeholderText(): string {
    return this.domain ? `Escribe '${this.domain.hostname}' para confirmar` : '';
  }

  get isHostnameValid(): boolean {
    if (!this.domain || !this.hostnameInput.value) {
      return false;
    }
    return this.hostnameInput.value.trim() === this.domain.hostname;
  }

  onConfirm(): void {
    if (!this.isHostnameValid) {
      this.showError = true;
      return;
    }

    this.confirm.emit(this.domain!.hostname);
    this.hostnameInput.reset();
    this.showError = false;
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
    this.hostnameInput.reset();
    this.showError = false;
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.hostnameInput.reset();
      this.showError = false;
    }
  }
}
