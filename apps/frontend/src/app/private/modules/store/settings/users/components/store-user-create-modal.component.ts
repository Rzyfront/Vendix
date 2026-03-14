import {
  Component,
  Input,
  Output,
  EventEmitter,
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
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreUsersManagementService } from '../services/store-users-management.service';
import { CreateStoreUserDto } from '../interfaces/store-user.interface';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-store-user-create-modal',
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
      [isOpen]="isOpen"
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
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Perez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario"
            placeholder="juanperez"
            [control]="userForm.get('username')"
            [disabled]="isCreating"
            helpText="Opcional. Solo letras, numeros y guiones bajos"
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
            label="Contrasena *"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating"
            helpText="Minimo 8 caracteres, debe incluir mayuscula, minuscula, numero y caracter especial"
          ></app-input>

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
export class StoreUserCreateModalComponent implements OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() onUserCreated = new EventEmitter<void>();

  userForm: FormGroup;
  isCreating: boolean = false;
  private destroy$ = new Subject<void>();

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
      ],
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating) {
      Object.keys(this.userForm.controls).forEach((key) => {
        this.userForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.isCreating = true;
    const userData: CreateStoreUserDto = this.userForm.value;

    // Remove username if empty
    if (!userData.username) {
      delete userData.username;
    }

    this.storeUsersService
      .createUser(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCreating = false;
          this.toastService.success('Usuario creado exitosamente');
          this.onUserCreated.emit();
          this.isOpenChange.emit(false);
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating = false;
          console.error('Error creating store user:', error);
          const message =
            error?.error?.message || 'Error al crear el usuario';
          this.toastService.error(message);
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
    });
  }
}
