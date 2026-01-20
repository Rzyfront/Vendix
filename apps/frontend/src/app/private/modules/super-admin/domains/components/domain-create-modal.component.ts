import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';

import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

import { CreateDomainDto, DomainType } from '../interfaces/domain.interface';

@Component({
  selector: 'app-domain-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nuevo Dominio"
    >
      <form [formGroup]="domainForm" class="space-y-4">
          <div class="grid grid-cols-1 gap-4">
            <app-input
              formControlName="hostname"
              label="Hostname"
              type="text"
              placeholder="ejemplo.organizacion.com"
              [required]="true"
            ></app-input>

            <div>
              <label
                for="domain_type"
                class="block text-sm font-medium text-text-primary mb-1"
              >
                Tipo de Dominio
              </label>
              <select
                id="domain_type"
                formControlName="domain_type"
                class="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="primary">Primario</option>
                <option value="alias">Alias</option>
                <option value="customer">Cliente</option>
              </select>
            </div>

            <app-input
              formControlName="organization_id"
              label="ID de Organización"
              type="number"
              placeholder="ID de la organización"
              [required]="true"
            ></app-input>

            <app-input
              formControlName="store_id"
              label="ID de Tienda (Opcional)"
              type="number"
              placeholder="ID de la tienda"
            ></app-input>

            <div>
              <label
                for="primary_color"
                class="block text-sm font-medium text-text-primary mb-1"
              >
                Color Primario
              </label>
              <input
                type="color"
                id="primary_color"
                formControlName="primary_color"
                class="w-full h-10 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label
                for="theme"
                class="block text-sm font-medium text-text-primary mb-1"
              >
                Tema
              </label>
              <select
                id="theme"
                formControlName="theme"
                class="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="light">Claro</option>
                <option value="dark">Oscuro</option>
                <option value="auto">Automático</option>
              </select>
            </div>
          </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" size="sm" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          [loading]="isLoading"
          (clicked)="onSubmit()"
        >
          Crear Dominio
        </app-button>
      </div>
    </app-modal>
  `,
})
export class DomainCreateModalComponent {
  @Input() isOpen = false;
  @Input() isLoading = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() create = new EventEmitter<CreateDomainDto>();
  @Output() cancel = new EventEmitter<void>();
  domainForm!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.domainForm = this.fb.group({
      hostname: ['', [Validators.required, Validators.minLength(3)]],
      domain_type: [DomainType.PRIMARY, [Validators.required]],
      organization_id: [null, [Validators.required]],
      store_id: [null],
      primary_color: ['#7ED7A5'],
      theme: ['light'],
    });
  }

  open(): void {
    this.isOpen = true;
    this.domainForm.reset({
      hostname: '',
      domain_type: DomainType.PRIMARY,
      organization_id: null,
      store_id: null,
      primary_color: '#7ED7A5',
      theme: 'light',
    });
  }

  close(): void {
    this.isOpen = false;
    this.domainForm.reset();
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  onSubmit(): void {
    if (this.domainForm.invalid) {
      Object.keys(this.domainForm.controls).forEach((key) => {
        this.domainForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isLoading = true;

    const formData = this.domainForm.value;
    const domainData: CreateDomainDto = {
      hostname: formData.hostname,
      domain_type: formData.domain_type,
      organization_id: formData.organization_id,
      store_id: formData.store_id || undefined,
      config: {
        branding: {
          primary_color: formData.primary_color,
          theme: formData.theme,
        },
      },
    };

    this.create.emit(domainData);
  }

  getFieldError(fieldName: string): string {
    const control = this.domainForm.get(fieldName);
    if (control?.invalid && control?.touched) {
      if (control.errors?.['required']) {
        return 'Este campo es requerido';
      }
      if (control.errors?.['minlength']) {
        return 'Mínimo 3 caracteres';
      }
    }
    return '';
  }

  // Public method to set loading state
  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }

  // Public method to reset form
  resetForm(): void {
    this.domainForm.reset({
      hostname: '',
      domain_type: DomainType.PRIMARY,
      organization_id: null,
      store_id: null,
      primary_color: '#7ED7A5',
      theme: 'light',
    });
  }
}
