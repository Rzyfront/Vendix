import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import {
  InputComponent,
  ButtonComponent,
  ModalComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { CreateUserDto, UserState } from '../interfaces/user.interface';
import { Subject, takeUntil } from 'rxjs';


@Component({
  selector: 'app-user-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    ModalComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [size]="'lg'"
      title="Crear Nuevo Usuario"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Pérez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario *"
            placeholder="juanperez"
            [required]="true"
            [control]="userForm.get('username')"
            [disabled]="isCreating"
            helpText="Mínimo 3 caracteres, solo letras, números y guiones bajos"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email *"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="password"
            label="Contraseña *"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating"
            helpText="Mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial"
          ></app-input>



          <div class="space-y-2">
            <label
              class="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              Estado Inicial
            </label>
            <select
              formControlName="state"
              class="w-full px-3 py-2 border border-[var(--color-border)] rounded-md bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
              [disabled]="isCreating"
            >
              <option value="">Seleccionar estado</option>
              <option [value]="UserState.ACTIVE">Activo</option>
              <option [value]="UserState.INACTIVE">Inactivo</option>
              <option [value]="UserState.PENDING_VERIFICATION">
                Pendiente de Verificación
              </option>
            </select>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isCreating"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [disabled]="userForm.invalid || isCreating"
          [loading]="isCreating"
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
  ],
})
export class UserCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onUserCreated = new EventEmitter<void>();

  userForm: FormGroup;
  isCreating: boolean = false;
  UserState = UserState;
  private destroy$ = new Subject<void>();

  usersService = inject(UsersService);

  constructor(private fb: FormBuilder) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: [
        '',
        [
          Validators.required,
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
      ],
      state: [UserState.PENDING_VERIFICATION],
    });
  }

  ngOnInit(): void { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating) {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isCreating = true;
    const userData: CreateUserDto = this.userForm.value;

    this.usersService
      .createUser(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCreating = false;
          this.onUserCreated.emit();
          this.isOpenChange.emit(false);
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating = false;
          console.error('Error creating user:', error);
          // TODO: Show user-friendly error message
        },
      });
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
      password: '',
      state: UserState.PENDING_VERIFICATION,
    });
  }
}
