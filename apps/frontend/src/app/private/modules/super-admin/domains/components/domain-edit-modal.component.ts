import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
} from '@angular/core';
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

import {
  Domain,
  UpdateDomainDto,
  DomainType,
  DomainStatus,
} from '../interfaces/domain.interface';

@Component({
  selector: 'app-domain-edit-modal',
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
      [size]="'lg'"
      (isOpenChange)="onOpenChange($event)"
    >
      <div slot="header" class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-text-primary">Editar Dominio</h3>
        <button
          type="button"
          class="text-text-tertiary hover:text-text-secondary transition-colors"
          (click)="onCancel()"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div slot="content" class="space-y-4">
        <form [formGroup]="domainForm">
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

            <div>
              <label
                for="status"
                class="block text-sm font-medium text-text-primary mb-1"
              >
                Estado
              </label>
              <select
                id="status"
                formControlName="status"
                class="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="pending">Pendiente</option>
                <option value="verified">Verificado</option>
                <option value="failed">Fallido</option>
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
      </div>

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
          Actualizar Dominio
        </app-button>
      </div>
    </app-modal>
  `,
})
export class DomainEditModalComponent implements OnChanges {
  @Input() domain: Domain | null = null;
  @Input() isOpen = false;
  @Input() isLoading = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() update = new EventEmitter<{ id: number; data: UpdateDomainDto }>();
  @Output() cancel = new EventEmitter<void>();
  domainForm!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  ngOnChanges(): void {
    if (this.domain && this.isOpen) {
      this.populateForm();
    }
  }

  private initializeForm(): void {
    this.domainForm = this.fb.group({
      hostname: ['', [Validators.required, Validators.minLength(3)]],
      domain_type: [DomainType.PRIMARY, [Validators.required]],
      status: [DomainStatus.ACTIVE, [Validators.required]],
      organization_id: [null, [Validators.required]],
      store_id: [null],
      primary_color: ['#7ED7A5'],
      theme: ['light'],
    });
  }

  private populateForm(): void {
    if (!this.domain) return;

    this.domainForm.patchValue({
      hostname: this.domain.hostname,
      domain_type: this.domain.domain_type,
      status: this.domain.status,
      organization_id: this.domain.organization_id,
      store_id: this.domain.store_id || null,
      primary_color: this.domain.config?.branding?.primary_color || '#7ED7A5',
      theme: this.domain.config?.branding?.theme || 'light',
    });
  }

  open(domain: Domain): void {
    this.domain = domain;
    this.isOpen = true;
    this.populateForm();
  }

  close(): void {
    this.isOpen = false;
    this.domain = null;
    this.domainForm.reset();
  }

  onOpenChange(isOpen: boolean): void {
    this.isOpen = isOpen;
    if (!isOpen) {
      this.cancel.emit();
    }
  }

  onCancel(): void {
    this.close();
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.domainForm.invalid || !this.domain) {
      Object.keys(this.domainForm.controls).forEach((key) => {
        this.domainForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isLoading = true;

    const formData = this.domainForm.value;
    const domainData: UpdateDomainDto = {
      hostname: formData.hostname,
      domain_type: formData.domain_type,
      status: formData.status,
      config: {
        branding: {
          primary_color: formData.primary_color,
          theme: formData.theme,
        },
      },
    };

    this.update.emit({
      id: this.domain.id,
      data: domainData,
    });
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
      status: DomainStatus.ACTIVE,
      organization_id: null,
      store_id: null,
      primary_color: '#7ED7A5',
      theme: 'light',
    });
  }
}
