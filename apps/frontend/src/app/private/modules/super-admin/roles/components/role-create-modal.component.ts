import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CreateRoleDto,
  RoleScope,
  TenantOption,
} from '../interfaces/role.interface';
import { RolesService } from '../services/roles.service';
import { ROLE_SCOPE_FILTER_OPTIONS } from '../../../../../shared/constants/role-scope.constant';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { SelectorComponent } from '../../../../../shared/components/selector/selector.component';
import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';

/**
 * QUI-72 — Crear rol a nivel PLATAFORMA.
 *
 * El alcance lo decide el payload, no el contexto: superadmin es el único nivel
 * que puede crear roles de sistema, de una organización o de una tienda. El
 * checkbox binario anterior sólo sabía crear roles sin dueño, así que todo lo
 * creado aquí aparecía en el listado con el badge "Sistema".
 */
@Component({
  selector: 'app-role-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Crear Nuevo Rol"
      subtitle="Complete los detalles para crear un nuevo rol"
      size="md"
      [showCloseButton]="true"
      (closed)="onCancel()"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-5">
          <!-- Nombre -->
          <div class="form-group">
            <label for="name" class="form-label">Nombre del Rol *</label>
            <input
              id="name"
              type="text"
              formControlName="name"
              class="form-input"
              placeholder="ej., store_manager"
              [class.form-input-error]="
                roleForm.get('name')?.invalid && roleForm.get('name')?.touched
              "
            />
            @if (
              roleForm.get('name')?.invalid && roleForm.get('name')?.touched
            ) {
              <div class="form-error">
                @if (roleForm.get('name')?.errors?.['required']) {
                  <span>El nombre es requerido</span>
                }
                @if (roleForm.get('name')?.errors?.['minlength']) {
                  <span>El nombre debe tener al menos 2 caracteres</span>
                }
              </div>
            }
          </div>

          <!-- Descripción -->
          <div class="form-group">
            <label for="description" class="form-label">Descripción *</label>
            <textarea
              id="description"
              formControlName="description"
              rows="3"
              class="form-input"
              placeholder="Describe el rol y sus responsabilidades"
              [class.form-input-error]="
                roleForm.get('description')?.invalid &&
                roleForm.get('description')?.touched
              "
            ></textarea>
            @if (
              roleForm.get('description')?.invalid &&
              roleForm.get('description')?.touched
            ) {
              <div class="form-error">
                @if (roleForm.get('description')?.errors?.['required']) {
                  <span>La descripción es requerida</span>
                }
                @if (roleForm.get('description')?.errors?.['minlength']) {
                  <span>La descripción debe tener al menos 10 caracteres</span>
                }
              </div>
            }
          </div>

          <!-- Alcance -->
          <div class="form-group">
            <app-selector
              label="Alcance del rol *"
              [options]="scopeOptions"
              [formControl]="$any(roleForm.get('scope'))"
              size="sm"
              variant="outline"
              helpText="Sistema = sin dueño. Organización y Tienda acotan el rol a ese tenant."
              (valueChange)="onScopeChange($event)"
            ></app-selector>
          </div>

          @if (selectedScope() !== 'system') {
            <div class="form-group">
              <app-selector
                label="Organización dueña *"
                [options]="organizationOptions()"
                [formControl]="$any(roleForm.get('organization_id'))"
                [searchable]="true"
                size="sm"
                variant="outline"
                (valueChange)="onOrganizationChange($event)"
              ></app-selector>
            </div>
          }

          @if (selectedScope() === 'store') {
            <div class="form-group">
              <app-selector
                label="Tienda dueña *"
                [options]="storeOptions()"
                [formControl]="$any(roleForm.get('store_id'))"
                [searchable]="true"
                size="sm"
                variant="outline"
                helpText="La tienda debe pertenecer a la organización elegida."
              ></app-selector>
            </div>
          }
        </div>

        <div class="modal-footer mt-6">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="isSubmitting() || roleForm.invalid"
            [loading]="isSubmitting()"
          >
            @if (!isSubmitting()) {
              <span>Crear Rol</span>
            }
            @if (isSubmitting()) {
              <span>Creando...</span>
            }
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrls: ['./role-create-modal.component.scss'],
})
export class RoleCreateModalComponent implements OnChanges {
  // Signals
  readonly isOpen = input<boolean>(false);
  readonly isSubmitting = input<boolean>(false);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly submit = output<CreateRoleDto>();
  readonly cancel = output<void>();

  readonly scopeOptions: SelectorOption[] = ROLE_SCOPE_FILTER_OPTIONS.map(
    (option) => ({ value: option.value, label: option.label }),
  );
  readonly organizationOptions = signal<SelectorOption[]>([]);
  readonly storeOptions = signal<SelectorOption[]>([]);
  readonly selectedScope = signal<RoleScope>('system');

  roleForm: FormGroup;
  private fb = inject(FormBuilder);
  private rolesService = inject(RolesService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      scope: ['system'],
      organization_id: [''],
      store_id: [''],
    });

    this.loadOrganizations();
  }

  onOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      this.onCancel();
    }
    this.isOpenChange.emit(isOpen);
  }

  onScopeChange(value: string | number | null): void {
    const scope = (value || 'system') as RoleScope;
    this.selectedScope.set(scope);

    const organizationControl = this.roleForm.get('organization_id');
    const storeControl = this.roleForm.get('store_id');

    // Los validadores siguen al alcance: exigir organización con alcance
    // "sistema" dejaría el formulario inválido para siempre.
    if (scope === 'system') {
      organizationControl?.clearValidators();
      organizationControl?.setValue('', { emitEvent: false });
      storeControl?.clearValidators();
      storeControl?.setValue('', { emitEvent: false });
      this.storeOptions.set([]);
    } else {
      organizationControl?.setValidators([Validators.required]);
      if (scope === 'store') {
        storeControl?.setValidators([Validators.required]);
      } else {
        storeControl?.clearValidators();
        storeControl?.setValue('', { emitEvent: false });
      }
    }

    organizationControl?.updateValueAndValidity({ emitEvent: false });
    storeControl?.updateValueAndValidity({ emitEvent: false });
  }

  onOrganizationChange(value: string | number | null): void {
    const organizationId = value ? Number(value) : null;
    this.roleForm.patchValue({ store_id: '' }, { emitEvent: false });
    this.loadStores(organizationId);
  }

  onSubmit(): void {
    if (!this.roleForm.valid) {
      this.roleForm.markAllAsTouched();
      return;
    }

    const scope = this.selectedScope();
    const organizationId = this.toId(this.roleForm.get('organization_id')?.value);
    const storeId = this.toId(this.roleForm.get('store_id')?.value);

    const roleData: CreateRoleDto = {
      name: this.roleForm.value.name,
      description: this.roleForm.value.description,
      is_system_role: scope === 'system',
      organization_id: scope === 'system' ? null : organizationId,
      store_id: scope === 'store' ? storeId : null,
    };

    this.submit.emit(roleData);
  }

  onCancel(): void {
    this.cancel.emit();
    this.resetForm();
  }

  // Reset form when modal opens
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue) {
      this.resetForm();
    }
  }

  private resetForm(): void {
    this.roleForm.reset({
      name: '',
      description: '',
      scope: 'system',
      organization_id: '',
      store_id: '',
    });
    this.selectedScope.set('system');
    this.storeOptions.set([]);
    this.onScopeChange('system');
  }

  private loadOrganizations(): void {
    this.rolesService
      .getOrganizationOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => this.organizationOptions.set(this.toOptions(options)),
        error: () => this.organizationOptions.set([]),
      });
  }

  private loadStores(organizationId: number | null): void {
    if (organizationId == null) {
      this.storeOptions.set([]);
      return;
    }

    this.rolesService
      .getStoreOptions(organizationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => this.storeOptions.set(this.toOptions(options)),
        error: () => this.storeOptions.set([]),
      });
  }

  private toOptions(items: TenantOption[]): SelectorOption[] {
    return items.map((item) => ({ value: String(item.id), label: item.name }));
  }

  private toId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
