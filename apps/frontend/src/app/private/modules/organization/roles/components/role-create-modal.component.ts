import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { OrganizationStoresService } from '../../stores/services/organization-stores.service';
import { CreateRoleDto } from '../interfaces/role.interface';
import {
  StoreScopeOption,
  StoreScopeSelectComponent,
} from './store-scope-select.component';

/**
 * QUI-72 — creación de rol en el nivel ORGANIZACIÓN.
 *
 * El backend acepta un `store_id` OPCIONAL: sin tienda nace un rol de alcance
 * ORGANIZACIÓN; con tienda, un rol de alcance TIENDA para una tienda propia
 * (el backend valida la propiedad y responde 403 `ROLE_ASSIGN_007` si no lo es).
 * `system_role` NO se envía: el nivel organización nunca crea roles de sistema.
 */
@Component({
  selector: 'app-role-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    StoreScopeSelectComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      title="Crear Nuevo Rol"
      subtitle="Define un rol de organización o, eligiendo una tienda, un rol de tienda"
      size="md"
    >
      <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <app-input
            formControlName="name"
            label="Nombre del Rol *"
            placeholder="Ej: Gerente de Ventas"
            [required]="true"
            [control]="roleForm.get('name')"
            [disabled]="isCreating()"
            helperText="Nombre único, mínimo 2 caracteres, máximo 50"
          ></app-input>

          <app-input
            formControlName="description"
            label="Descripción"
            placeholder="Describe las responsabilidades de este rol"
            [control]="roleForm.get('description')"
            [disabled]="isCreating()"
            helperText="Opcional, ayuda a otros administradores a entender el propósito del rol"
          ></app-input>

          <app-store-scope-select
            label="Alcance del rol"
            emptyLabel="Rol de organización (todas las tiendas)"
            [stores]="storeOptions()"
            [disabled]="isCreating()"
            [helpText]="scopeHelpText()"
            [(value)]="selectedStoreId"
          ></app-store-scope-select>

          <div class="p-4 bg-muted/20 rounded-lg">
            <div class="flex items-start gap-3">
              <app-icon
                name="info"
                [size]="20"
                class="text-primary mt-0.5"
              ></app-icon>
              <div class="text-sm text-text-secondary">
                <p class="font-medium text-text-primary mb-1">
                  Nota sobre Roles
                </p>
                <p>
                  Los roles que creas aquí son editables y eliminables después.
                  Los roles de sistema los administra únicamente la plataforma.
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isCreating()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="roleForm.invalid || isCreating()"
          [loading]="isCreating()"
        >
          Crear Rol
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
export class RoleCreateModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly storesService = inject(OrganizationStoresService);
  private readonly fb = inject(FormBuilder);

  readonly isOpen = input<boolean>(false);
  readonly isCreating = input<boolean>(false);

  readonly isOpenChange = output<boolean>();
  readonly roleCreated = output<CreateRoleDto>();
  readonly cancel = output<void>();

  readonly roleForm: FormGroup;

  readonly storeOptions = signal<StoreScopeOption[]>([]);
  readonly selectedStoreId = signal<number | null>(null);

  readonly scopeHelpText = computed(() => {
    const storeId = this.selectedStoreId();
    if (storeId === null) {
      return 'Sin tienda, el rol vale para toda la organización.';
    }
    const store = this.storeOptions().find((s) => s.id === storeId);
    return `El rol pertenecerá a ${store?.name ?? 'la tienda seleccionada'} y sólo se podrá asignar ahí.`;
  });

  constructor() {
    this.roleForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(50),
          Validators.pattern(/^[a-zA-Z0-9_\s-]+$/),
        ],
      ],
      description: ['', [Validators.maxLength(255)]],
    });

    this.loadStores();
  }

  onSubmit(): void {
    if (this.roleForm.invalid || this.isCreating()) {
      Object.keys(this.roleForm.controls).forEach((key) => {
        this.roleForm.get(key)?.markAsTouched();
      });
      return;
    }

    const storeId = this.selectedStoreId();
    const roleData: CreateRoleDto = {
      name: this.roleForm.value.name.trim(),
      description: this.roleForm.value.description?.trim() || undefined,
      // Se omite cuando es NULL: el DTO del backend corre con
      // `forbidNonWhitelisted`, y mandar `store_id: null` a un `@IsInt()`
      // opcional lo rechazaría con 422 en vez de crear un rol de organización.
      ...(storeId !== null ? { store_id: storeId } : {}),
    };

    this.roleCreated.emit(roleData);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  resetForm(): void {
    this.roleForm.reset({
      name: '',
      description: '',
    });
    this.selectedStoreId.set(null);
  }

  private loadStores(): void {
    this.storesService
      .getStores({ limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) =>
          this.storeOptions.set(
            (response.data?.flat() || []).map((store) => ({
              id: store.id,
              name: store.name,
            })),
          ),
        error: () => this.storeOptions.set([]),
      });
  }
}
