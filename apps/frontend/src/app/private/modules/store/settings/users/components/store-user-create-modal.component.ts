import {Component,
  computed,
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
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreUsersManagementService } from '../services/store-users-management.service';
import {
  createUsernameFieldState,
  usernameAvailabilityValidator,
  USERNAME_INVALID_MESSAGE_STORE,
} from '../../../../../../shared/utils/username-availability.validator';

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

/** H0.5 — roles base de hotelería; sólo se ofrecen en tiendas Hotelería. */
const HOSPITALITY_ROLE_OPTIONS: readonly SelectorOption[] = [
  { value: 'receptionist', label: 'Recepcionista' },
  { value: 'housekeeper', label: 'Camarera' },
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

          <div>
            <app-input
              formControlName="username"
              label="Nombre de Usuario"
              placeholder="juanperez"
              [control]="userForm.get('username')"
              [disabled]="isCreating()"
              [error]="usernameState.error() ?? undefined"
              helpText="Opcional. Solo letras, numeros y guiones bajos"
            ></app-input>
            @if (usernameState.pending()) {
              <p class="mt-1 text-sm text-[var(--color-text-secondary)]" aria-live="polite">Verificando…</p>
            } @else if (usernameState.available()) {
              <p class="mt-1 text-sm text-[var(--color-success)]" aria-live="polite">Disponible</p>
            }
          </div>

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
            [options]="roleOptions()"
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
          [disabled]="userForm.invalid || usernameState.pending() || isCreating()"
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
  readonly usernameState: ReturnType<typeof createUsernameFieldState>;
  private readonly usersService = inject(StoreUsersManagementService);
  private readonly authFacade = inject(AuthFacade);
  /** Los roles de hotelería se suman sólo si la tienda es un hotel. */
  readonly roleOptions = computed<SelectorOption[]>(() =>
    this.authFacade.isHospitality()
      ? [...CREATE_USER_ROLE_OPTIONS, ...HOSPITALITY_ROLE_OPTIONS]
      : [...CREATE_USER_ROLE_OPTIONS],
  );
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
        // Default `updateOn: 'change'` on purpose: live feedback while typing.
        // Empty stays valid (the backend autogenerates the username).
        [
          usernameAvailabilityValidator((username, excludeId) =>
            this.usersService.checkUsernameAvailability(username, excludeId),
          ),
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

    this.usernameState = createUsernameFieldState(
      this.userForm.controls['username'],
      () => null,
      undefined,
      USERNAME_INVALID_MESSAGE_STORE,
    );

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

    // Fallo: el modal se queda abierto con lo tecleado intacto; el toast de
    // error lo emite `createUser$` y el botón se reactiva solo porque el
    // reducer devuelve `user_saving` a false. Única excepción: un username
    // tomado (409 USER_USERNAME_TAKEN) se marca en el campo, sin toast.
    this.actions$
      .pipe(
        ofType(StoreUsersActions.createUserFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ error_code }) => {
        if (error_code === 'USER_USERNAME_TAKEN') {
          const control = this.userForm.controls['username'];
          control.setErrors({ usernameTaken: true });
          control.markAsTouched();
        }
      });
  }

  onSubmit(): void {
    if (
      this.userForm.invalid ||
      this.userForm.pending ||
      this.isCreating()
    ) {
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
