import {Component,
  input,
  output,
  model,
  signal,
  inject,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
  ToastService} from '../../../../../../shared/components/index';
import { StoreUsersManagementService } from '../services/store-users-management.service';
import { CreateStoreUserDto } from '../interfaces/store-user.interface';


@Component({
  selector: 'app-store-user-create-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
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
            label="Contrasena *"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating()"
            helpText="Minimo 8 caracteres, debe incluir mayuscula, minuscula, numero y caracter especial"
          ></app-input>
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
export class StoreUserCreateModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onUserCreated = output<void>();

  userForm: FormGroup;
  isCreating = signal(false);
  private storeUsersService = inject(StoreUsersManagementService);
  private toastService = inject(ToastService);

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
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
          ),
        ],
      ]});
  }
onSubmit(): void {
    if (this.userForm.invalid || this.isCreating()) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isCreating.set(true);
    const userData: CreateStoreUserDto = this.userForm.value;

    // Remove username if empty
    if (!userData.username) {
      delete userData.username;
    }

    this.storeUsersService
      .createUser(userData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isCreating.set(false);
          this.toastService.success('Usuario creado exitosamente');
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          // TODO: The 'emit' function requires a mandatory void argument
          this.onUserCreated.emit();
          this.isOpenChange.emit(false);
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating.set(false);
          console.error('Error creating store user:', error);
          const message = error?.error?.message || 'Error al crear el usuario';
          this.toastService.error(message);
        }});
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  resetForm(): void {
    this.userForm.reset({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      password: ''});
  }
}
