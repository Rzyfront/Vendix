import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
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
  Domain,
  UpdateDomainDto,
  DomainOwnership,
  AppType,
} from '../../interfaces/domain.interface';
import { OrganizationDomainsService } from '../../services/organization-domains.service';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  ToggleComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-domain-edit-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
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
      title="Editar Dominio"
      [subtitle]="domain?.hostname || ''"
    >
      <!-- Vendix Subdomain Warning - Read Only -->
      <div *ngIf="isVendixSubdomain" class="space-y-4">
        <div
          class="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800"
        >
          <div class="flex items-start gap-3">
            <app-icon
              name="alert-triangle"
              [size]="20"
              class="text-amber-600 dark:text-amber-400 mt-0.5"
            />
            <div>
              <h4 class="font-medium text-amber-800 dark:text-amber-200">
                Subdominio de Vendix
              </h4>
              <p class="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Los subdominios de Vendix son gestionados automáticamente por el
                sistema y no pueden ser editados. Si necesitas cambiar la
                configuración, contacta al soporte técnico.
              </p>
            </div>
          </div>
        </div>

        <!-- Domain Info (Read Only) -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="globe" [size]="16" />
            Información del Dominio
          </h3>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-[var(--color-text-secondary)] mb-1">
                Hostname
              </label>
              <div class="text-sm font-medium text-[var(--color-text-primary)]">
                {{ domain?.hostname }}
              </div>
            </div>
            <div>
              <label class="block text-xs text-[var(--color-text-secondary)] mb-1">
                Estado
              </label>
              <div class="text-sm font-medium text-green-600">
                {{ formatStatus(domain?.status) }}
              </div>
            </div>
            <div>
              <label class="block text-xs text-[var(--color-text-secondary)] mb-1">
                Tipo de Aplicación
              </label>
              <div class="text-sm text-[var(--color-text-primary)]">
                {{ formatAppType(domain?.app_type) }}
              </div>
            </div>
            <div>
              <label class="block text-xs text-[var(--color-text-secondary)] mb-1">
                Creado
              </label>
              <div class="text-sm text-[var(--color-text-primary)]">
                {{ domain?.created_at | date : 'dd/MM/yyyy HH:mm' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Editable Form (Non-Vendix Domains) -->
      <form *ngIf="!isVendixSubdomain" [formGroup]="domainForm" class="space-y-4">
        <!-- Hostname Display (readonly) -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="globe" [size]="16" />
            Información del Dominio
          </h3>

          <div class="space-y-3">
            <div>
              <label
                class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1"
              >
                Hostname
              </label>
              <div
                class="px-3 py-2 bg-[var(--color-muted)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                {{ domain?.hostname }}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label
                  class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Estado
                </label>
                <div class="text-sm text-[var(--color-text-primary)] flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full"
                    [ngClass]="{
                      'bg-green-500': domain?.status === 'active',
                      'bg-yellow-500': domain?.status === 'pending_dns' || domain?.status === 'pending_ssl',
                      'bg-red-500': domain?.status === 'disabled'
                    }"
                  ></span>
                  {{ formatStatus(domain?.status) }}
                  <span class="text-xs text-[var(--color-text-secondary)]">
                    (gestionado automáticamente)
                  </span>
                </div>
              </div>
              <div>
                <label
                  class="block text-sm font-medium text-[var(--color-text-secondary)] mb-1"
                >
                  Última verificación
                </label>
                <div class="text-sm text-[var(--color-text-primary)]">
                  {{
                    domain?.last_verified_at
                      ? (domain?.last_verified_at | date : 'dd/MM/yyyy HH:mm')
                      : 'Nunca'
                  }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Configuration Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="settings" [size]="16" />
            Configuración
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Ownership -->
            <app-selector
              formControlName="ownership"
              label="Tipo de Dominio"
              [options]="ownershipOptions"
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
            <app-icon name="sliders" [size]="16" />
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

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSubmitting"
        >
          {{ isVendixSubdomain ? 'Cerrar' : 'Cancelar' }}
        </app-button>
        <app-button
          *ngIf="!isVendixSubdomain"
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="domainForm.invalid || isSubmitting"
          [loading]="isSubmitting"
        >
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          Guardar Cambios
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
export class DomainEditModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() domain: Domain | null = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<{ hostname: string; data: UpdateDomainDto }>();
  @Output() cancel = new EventEmitter<void>();

  domainForm!: FormGroup;
  ownershipOptions: SelectorOption[] = [];
  appTypeOptions: SelectorOption[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private domainsService: OrganizationDomainsService,
  ) {
    this.initializeForm();
  }

  ngOnInit(): void {
    this.loadOptions();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['domain'] && this.domain) {
      this.populateForm();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Check if domain is a Vendix subdomain (read-only)
   */
  get isVendixSubdomain(): boolean {
    return this.domain?.ownership === DomainOwnership.VENDIX_SUBDOMAIN;
  }

  private initializeForm(): void {
    this.domainForm = this.fb.group({
      ownership: [DomainOwnership.VENDIX_SUBDOMAIN],
      app_type: [null],
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
  }

  private populateForm(): void {
    if (!this.domain) return;

    this.domainForm.patchValue({
      ownership: this.domain.ownership,
      app_type: this.domain.app_type,
      is_primary: this.domain.is_primary,
    });
  }

  formatStatus(status: string | undefined): string {
    const statusMap: Record<string, string> = {
      active: 'Activo',
      pending_dns: 'Pendiente DNS',
      pending_ssl: 'Pendiente SSL',
      disabled: 'Deshabilitado',
    };
    return statusMap[status || ''] || status || 'Desconocido';
  }

  formatAppType(appType: string | undefined | null): string {
    const appTypeMap: Record<string, string> = {
      STORE_ECOMMERCE: 'E-commerce',
      STORE_ADMIN: 'Admin Tienda',
      STORE_LANDING: 'Landing Tienda',
      ORG_ADMIN: 'Admin Organización',
      ORG_LANDING: 'Landing Organización',
      VENDIX_LANDING: 'Vendix Landing',
      VENDIX_ADMIN: 'Vendix Admin',
    };
    return appTypeMap[appType || ''] || appType || 'No definido';
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit(): void {
    // Don't allow editing Vendix subdomains
    if (this.isVendixSubdomain) {
      return;
    }

    if (this.domainForm.invalid || !this.domain) {
      this.domainForm.markAllAsTouched();
      return;
    }

    const formValue = this.domainForm.value;

    // Status is not editable - it's managed by internal validation flows
    const updateData: UpdateDomainDto = {
      ownership: formValue.ownership,
      app_type: formValue.app_type || undefined,
      is_primary: formValue.is_primary,
    };

    this.submit.emit({
      hostname: this.domain.hostname,
      data: updateData,
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

    return 'Valor inválido';
  }
}
