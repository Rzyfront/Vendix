import {Component,
  output,
  model,
  inject,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  PasswordRequirementsComponent,
  SelectorComponent} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/index';
import { passwordPolicyValidator } from '../../../../../../core/utils/password-policy';
import * as StoreUsersActions from '../state/actions/store-users.actions';
import { selectUserSaving } from '../state/selectors/store-users.selectors';
import { CreateStoreUserDto } from '../interfaces/store-user.interface';

/**
 * QUI-581 — Roles asignables al crear, espejo de `ASSIGNABLE_SYSTEM_ROLES.store`
 * (backend: `ASSIGNABLE_STORE_USER_ROLES`, que es lo que valida el `@IsIn` del DTO).
 *
 * `employee` va primero porque es el valor por defecto: quien no toque el campo
 * obtiene exactamente el comportamiento previo al ticket.
 *
 * `carrier` no duplica la derivación de `app_type`: el backend fuerza
 * `STORE_DELIVERY` al detectar ese rol.
 */
const CREATE_USER_ROLE_OPTIONS: readonly SelectorOption[] = [
  { value: 'employee', label: 'Empleado' },
  { value: 'cashier', label: 'Cajero' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Gerente' },
  { value: 'carrier', label: 'Repartidor' },
];

@Component({
  selector: 'app-store-user-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
    PasswordRequirementsComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nuevo Usuario"
      subtitle="Completa el formulario para agregar un nuevo usuario a la tienda"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Perez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario"
            placeholder="juanperez"
            [control]="userForm.get('username')"
            [disabled]="isCreating()"
            helpText="Opcional. Solo letras, numeros y guiones bajos"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email *"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isCreating()"
          ></app-input>

          <app-input
            formControlName="password"
            label="Contraseña *"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating()"
          ></app-input>

          <app-password-requirements
            [control]="userForm.get('password')"
          ></app-password-requirements>

          <app-selector
            formControlName="role"
            label="Rol *"
            [options]="roleOptions"
            [disabled]="isCreating()"
            helpText="Define que puede hacer el usuario. Se puede cambiar despues."
          ></app-selector>
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
          [disabled]="userForm.invalid || isCreating()"
          [loading]="isCreating()"
        >
          Crear Usuario
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
  ]})
/**
 * QUI-554 — Este modal NO llama HTTP. Despacha `createUser` y espera el
 * resultado en el stream de acciones:
 *
 *   createUser → createUser$ (POST + toast) → createUserSuccess
 *              → mutationSuccess$ → loadUsers + loadStats
 *
 * Antes llamaba `StoreUsersManagementService.createUser()` directo, así que la
 * acción nunca se despachaba, `createUserSuccess` nunca se emitía y el effect
 * `mutationSuccess$` —que ya existía— jamás recargaba la lista ni las stats.
 *
 * Se cierra sólo con `createUserSuccess`: cerrar antes de conocer el resultado
 * destruiría el formulario ante un 400 (email duplicado, validación).
 */
export class StoreUserCreateModalComponent {
  private destroyRef = inject(DestroyRef);
  /**
   * `model()` ya publica el output implícito `isOpenChange`; declarar además un
   * `output<boolean>()` homónimo crearía dos canales para un solo dato y dejaría
   * este `model` desincronizado. El cierre se hace con `isOpen.set(false)`.
   */
  readonly isOpen = model<boolean>(false);
  readonly onUserCreated = output<void>();

  userForm: FormGroup;
  /** Constante, no señal: la lista no depende del estado. */
  readonly roleOptions = CREATE_USER_ROLE_OPTIONS as SelectorOption[];
  private store = inject(Store);
  private actions$ = inject(Actions);
  /** Progreso real de la mutación, tomado del state (no un flag local). */
  readonly isCreating = this.store.selectSignal(selectUserSaving);

  constructor(private fb: FormBuilder) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: [
        '',
        [
          Validators.minLength(3),
          Validators.maxLength(50),
          Validators.pattern(/^[a-zA-Z0-9_]+$/),
        ],
      ],
      email: [
        '',
        [Validators.required, Validators.email, Validators.maxLength(255)],
      ],
      // Política única: `core/utils/password-policy`. El regex anterior exigía
      // uno de `@$!%*?&`, así que rechazaba símbolos legítimos como el punto y
      // divergía del resto de la app.
      password: ['', [Validators.required, passwordPolicyValidator]],
      // QUI-581 — `employee` por defecto: preserva el comportamiento anterior al
      // ticket para quien no toque el campo.
      role: ['employee', [Validators.required]]});

    // Éxito: limpiar, cerrar y avisar al padre. El toast y la recarga de lista
    // + stats los hacen `createUser$` y `mutationSuccess$` respectivamente.
    this.actions$
      .pipe(
        ofType(StoreUsersActions.createUserSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.resetForm();
        this.isOpen.set(false);
        this.onUserCreated.emit();
      });

    // Fallo: deliberadamente NO se escucha. El modal debe quedarse abierto con
    // lo tecleado intacto, el toast de error lo emite `createUser$` y el botón
    // se reactiva solo porque el reducer devuelve `user_saving` a false.
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating()) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    const userData: CreateStoreUserDto = { ...this.userForm.value };

    // Remove username if empty
    if (!userData.username) {
      delete userData.username;
    }

    this.store.dispatch(StoreUsersActions.createUser({ user: userData }));
  }

  onCancel(): void {
    this.isOpen.set(false);
    this.resetForm();
  }

  resetForm(): void {
    this.userForm.reset({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      password: '',
      role: 'employee'});
  }
}
