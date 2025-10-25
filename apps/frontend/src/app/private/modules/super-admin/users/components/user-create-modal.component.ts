import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  IconComponent,
  InputComponent,
  ButtonComponent,
  ModalComponent
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { CreateUserDto, UserState } from '../interfaces/user.interface';
import { Observable, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-user-create-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent, InputComponent, ButtonComponent, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Crear Nuevo Usuario"
      (openChange)="onClose.emit()"
    >
      <form [formGroup]="userForm" (ngSubmit)="onSubmit()">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-input
            formControlName="first_name"
            label="Nombre"
            placeholder="Juan"
            [required]="true"
            [control]="userForm.get('first_name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido"
            placeholder="Pérez"
            [required]="true"
            [control]="userForm.get('last_name')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="username"
            label="Nombre de Usuario"
            placeholder="juanperez"
            [required]="true"
            [control]="userForm.get('username')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="email"
            label="Email"
            type="email"
            placeholder="juan@ejemplo.com"
            [required]="true"
            [control]="userForm.get('email')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="organization_id"
            label="ID de Organización"
            type="number"
            placeholder="1"
            [required]="true"
            [control]="userForm.get('organization_id')"
            [disabled]="isCreating"
          ></app-input>

          <app-input
            formControlName="password"
            label="Contraseña"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="userForm.get('password')"
            [disabled]="isCreating"
          ></app-input>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-text">
              Aplicación
            </label>
            <select
              formControlName="app"
              class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              [disabled]="isCreating"
            >
              <option value="">Seleccionar aplicación</option>
              <option value="ORG_ADMIN">ORG_ADMIN</option>
              <option value="STORE_ADMIN">STORE_ADMIN</option>
              <option value="STORE_ECOMMERCE">STORE_ECOMMERCE</option>
              <option value="VENDIX_LANDING">VENDIX_LANDING</option>
            </select>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-text">
              Estado Inicial
            </label>
            <select
              formControlName="state"
              class="w-full px-3 py-2 border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              [disabled]="isCreating"
            >
              <option value="">Seleccionar estado</option>
              <option [value]="UserState.ACTIVE">Activo</option>
              <option [value]="UserState.INACTIVE">Inactivo</option>
              <option [value]="UserState.PENDING_VERIFICATION">Pendiente de Verificación</option>
            </select>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose.emit()"
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
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class UserCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen: boolean = false;
  @Output() onClose = new EventEmitter<void>();
  @Output() onUserCreated = new EventEmitter<void>();

  userForm: FormGroup;
  isCreating: boolean = false;
  UserState = UserState;
  private destroy$ = new Subject<void>();

  usersService = inject(UsersService);

  constructor(
    private fb: FormBuilder
  ) {
    this.userForm = this.fb.group({
      first_name: ['', [Validators.required, Validators.maxLength(100)]],
      last_name: ['', [Validators.required, Validators.maxLength(100)]],
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
      organization_id: [null, [Validators.required]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      app: [''],
      state: [UserState.PENDING_VERIFICATION]
    });
  }

  ngOnInit(): void {
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSubmit(): void {
    if (this.userForm.invalid || this.isCreating) {
      return;
    }

    this.isCreating = true;
    const userData: CreateUserDto = this.userForm.value;

    this.usersService.createUser(userData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isCreating = false;
          this.onUserCreated.emit();
          this.onClose.emit();
          this.resetForm();
        },
        error: (error: any) => {
          this.isCreating = false;
          console.error('Error creating user:', error);
        }
      });
  }

  resetForm(): void {
    this.userForm.reset({
      first_name: '',
      last_name: '',
      username: '',
      email: '',
      organization_id: null,
      password: '',
      app: '',
      state: UserState.PENDING_VERIFICATION
    });
  }
}