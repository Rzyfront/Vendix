import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  CreateDomainDto,
  DomainOwnership,
  AppType,
} from '../../interfaces/domain.interface';
import { OrganizationDomainsService } from '../../services/organization-domains.service';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  ToggleComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

interface StoreOption {
  id: number;
  name: string;
  slug: string;
}

@Component({
  selector: 'app-domain-create-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Crear Nuevo Dominio"
      subtitle="Configura un nuevo dominio para tu organización o tienda"
    >
      <form [formGroup]="domainForm" class="space-y-4">
        <!-- Hostname Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="globe" [size]="16" />
            Configuración del Dominio
          </h3>

          <div class="space-y-4">
            <!-- Ownership Type -->
            <app-selector
              formControlName="ownership"
              label="Tipo de Dominio"
              [options]="ownershipOptions"
              [required]="true"
              [errorText]="getErrorMessage(domainForm.get('ownership'))"
              placeholder="Seleccionar tipo"
              size="md"
            />

            <!-- Hostname Input -->
            <div class="space-y-2">
              <label
                class="block text-sm font-medium text-[var(--color-text-primary)]"
              >
                Hostname <span class="text-[var(--color-destructive)]">*</span>
              </label>
              <div class="flex items-center gap-2">
                <app-input
                  formControlName="hostname"
                  [placeholder]="hostnamePlaceholder"
                  [required]="true"
                  [control]="domainForm.get('hostname')"
                  [error]="getErrorMessage(domainForm.get('hostname'))"
                  size="md"
                  class="flex-1"
                >
                  <app-icon name="link" [size]="16" slot="prefix" />
                </app-input>
                <span
                  *ngIf="isVendixSubdomain"
                  class="text-sm text-[var(--color-text-secondary)] whitespace-nowrap"
                >
                  .vendix.com
                </span>
              </div>
              <p class="text-xs text-[var(--color-text-secondary)]">
                {{ hostnameHelperText }}
              </p>
            </div>
          </div>
        </div>

        <!-- Assignment Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="link-2" [size]="16" />
            Asignación
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Store Selection -->
            <app-selector
              formControlName="store_id"
              label="Tienda (opcional)"
              [options]="storeOptions"
              placeholder="Sin tienda asignada"
              size="md"
            />

            <!-- App Type -->
            <app-selector
              formControlName="app_type"
              label="Tipo de Aplicación"
              [options]="appTypeOptions"
              placeholder="Seleccionar aplicación"
              size="md"
            />
          </div>
        </div>

        <!-- Options Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="settings" [size]="16" />
            Opciones
          </h3>

          <div class="flex items-center gap-4">
            <app-toggle formControlName="is_primary" label="Dominio primario" />
            <span class="text-sm text-[var(--color-text-secondary)]">
              El dominio primario será el principal para la tienda u organización
            </span>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-[var(--color-text-secondary)]">
          <span class="text-[var(--color-destructive)]">*</span> Campos
          requeridos
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="domainForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Crear Dominio
          </app-button>
        </div>
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
export class DomainCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() stores: StoreOption[] = [];

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<CreateDomainDto>();
  @Output() cancel = new EventEmitter<void>();

  domainForm!: FormGroup;
  ownershipOptions: SelectorOption[] = [];
  appTypeOptions: SelectorOption[] = [];
  storeOptions: SelectorOption[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private domainsService: OrganizationDomainsService,
  ) {
    this.initializeForm();
  }

  ngOnInit(): void {
    this.loadOptions();
    this.setupOwnershipListener();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForm(): void {
    this.domainForm = this.fb.group({
      hostname: [
        '',
        [
          Validators.required,
          Validators.minLength(3),
          Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]$/),
        ],
      ],
      ownership: [DomainOwnership.VENDIX_SUBDOMAIN, [Validators.required]],
      store_id: [null],
      app_type: [AppType.STORE_ECOMMERCE],
      is_primary: [false],
    });
  }

  private loadOptions(): void {
    this.ownershipOptions = this.domainsService
      .getDomainOwnershipOptions()
      .map((opt) => ({ value: opt.value, label: opt.label }));
    this.appTypeOptions = this.domainsService
      .getAppTypeOptions()
      .map((opt) => ({ value: opt.value, label: opt.label }));
    this.updateStoreOptions();
  }

  private updateStoreOptions(): void {
    this.storeOptions = [
      { value: '', label: 'Sin tienda asignada' },
      ...this.stores.map((store) => ({
        value: store.id.toString(),
        label: store.name,
      })),
    ];
  }

  private setupOwnershipListener(): void {
    this.domainForm
      .get('ownership')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((ownership) => {
        const hostnameControl = this.domainForm.get('hostname');
        if (ownership === DomainOwnership.VENDIX_SUBDOMAIN) {
          hostnameControl?.setValidators([
            Validators.required,
            Validators.minLength(3),
            Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9]$/),
          ]);
        } else {
          hostnameControl?.setValidators([
            Validators.required,
            Validators.minLength(3),
            Validators.pattern(
              /^[a-zA-Z0-9][a-zA-Z0-9\-\.]*[a-zA-Z0-9]\.[a-zA-Z]{2,}$/,
            ),
          ]);
        }
        hostnameControl?.updateValueAndValidity();
      });
  }

  get isVendixSubdomain(): boolean {
    return (
      this.domainForm.get('ownership')?.value === DomainOwnership.VENDIX_SUBDOMAIN
    );
  }

  get hostnamePlaceholder(): string {
    if (this.isVendixSubdomain) {
      return 'mi-tienda';
    }
    return 'mi-tienda.ejemplo.com';
  }

  get hostnameHelperText(): string {
    if (this.isVendixSubdomain) {
      return 'Tu subdominio se creará como: [nombre].vendix.com';
    }
    return 'Ingresa tu dominio completo (ej: tienda.tuempresa.com)';
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.domainForm.invalid) {
      this.domainForm.markAllAsTouched();
      return;
    }

    const formValue = this.domainForm.value;

    // Build hostname with suffix for Vendix subdomains
    let hostname = formValue.hostname;
    if (formValue.ownership === DomainOwnership.VENDIX_SUBDOMAIN) {
      hostname = `${formValue.hostname}.vendix.com`;
    }

    const domainData: CreateDomainDto = {
      hostname,
      ownership: formValue.ownership,
      store_id: formValue.store_id ? parseInt(formValue.store_id, 10) : undefined,
      app_type: formValue.app_type || undefined,
      is_primary: formValue.is_primary || false,
      config: {},
    };

    this.submit.emit(domainData);
  }

  private resetForm(): void {
    this.domainForm.reset({
      hostname: '',
      ownership: DomainOwnership.VENDIX_SUBDOMAIN,
      store_id: null,
      app_type: AppType.STORE_ECOMMERCE,
      is_primary: false,
    });
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors || !control.touched) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }
    if (errors['pattern']) {
      if (this.isVendixSubdomain) {
        return 'Solo letras, números y guiones. Debe empezar y terminar con letra o número';
      }
      return 'Formato de dominio inválido';
    }

    return 'Valor inválido';
  }
}
