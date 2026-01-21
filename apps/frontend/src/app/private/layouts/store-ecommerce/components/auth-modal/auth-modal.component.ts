import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store';
import { TenantFacade } from '../../../../../core/store';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (closed)="onClose()"
      [title]="isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'"
      [subtitle]="
        isLogin
          ? 'Ingresa tus credenciales para continuar'
          : 'Regístrate para realizar tu compra'
      "
      size="sm"
    >
      <div class="space-y-4 py-2">
        <!-- Tabs -->
        <div class="flex border-b border-[var(--color-border)] mb-4">
          <button
            type="button"
            (click)="switchMode(true)"
            [class.border-b-2]="isLogin"
            [class.border-[var(--color-primary)]]="isLogin"
            [class.text-[var(--color-primary)]]="isLogin"
            [class.text-[var(--color-text-secondary)]]="!isLogin"
            class="flex-1 py-2 text-sm font-medium transition-colors"
          >
            Login
          </button>
          <button
            type="button"
            (click)="switchMode(false)"
            [class.border-b-2]="!isLogin"
            [class.border-[var(--color-primary)]]="!isLogin"
            [class.text-[var(--color-primary)]]="!isLogin"
            [class.text-[var(--color-text-secondary)]]="isLogin"
            class="flex-1 py-2 text-sm font-medium transition-colors"
          >
            Registro
          </button>
        </div>

        <form [formGroup]="authForm" (ngSubmit)="onSubmit()" class="space-y-4">
          <ng-container *ngIf="!isLogin">
            <div class="grid grid-cols-2 gap-4">
              <app-input
                label="Nombre"
                placeholder="Ej. Juan"
                formControlName="first_name"
              ></app-input>
              <app-input
                label="Apellido"
                placeholder="Ej. Pérez"
                formControlName="last_name"
              ></app-input>
            </div>
          </ng-container>

          <app-input
            label="Correo Electrónico"
            type="email"
            placeholder="tu@email.com"
            formControlName="email"
          ></app-input>

          <app-input
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            formControlName="password"
          ></app-input>

          <div class="pt-4">
            <app-button
              type="submit"
              [variant]="'primary'"
              [fullWidth]="true"
              [loading]="(loading$ | async) || false"
            >
              {{ isLogin ? 'Entrar' : 'Registrarme' }}
            </app-button>
          </div>
        </form>
      </div>
    </app-modal>
  `,
})
export class AuthModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() initialMode: 'login' | 'register' = 'login';
  @Output() closed = new EventEmitter<void>();

  isLogin = true;
  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);
  private tenantFacade = inject(TenantFacade);

  loading$ = this.authFacade.loading$;
  authForm!: FormGroup;

  ngOnInit() {
    this.isLogin = this.initialMode === 'login';
    this.initForm();

    // Cerrar modal automáticamente cuando el usuario se loguea con éxito
    this.authFacade.isAuthenticated$.subscribe((isAuth) => {
      if (isAuth && this.isOpen) {
        this.onClose();
      }
    });
  }

  // React to input changes
  ngOnChanges() {
    if (this.initialMode) {
      this.isLogin = this.initialMode === 'login';
      if (this.authForm) {
        this.updateValidators();
      }
    }
  }

  initForm() {
    this.authForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      first_name: [''],
      last_name: [''],
    });
    this.updateValidators();
  }

  switchMode(isLogin: boolean) {
    this.isLogin = isLogin;
    this.updateValidators();
  }

  updateValidators() {
    const firstNameControl = this.authForm.get('first_name');
    const lastNameControl = this.authForm.get('last_name');

    if (this.isLogin) {
      firstNameControl?.clearValidators();
      lastNameControl?.clearValidators();
    } else {
      firstNameControl?.setValidators([Validators.required]);
      lastNameControl?.setValidators([Validators.required]);
    }

    firstNameControl?.updateValueAndValidity();
    lastNameControl?.updateValueAndValidity();
  }

  onClose() {
    this.isOpen = false;
    this.closed.emit();
    this.authForm.reset();
  }

  onSubmit() {
    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      return;
    }

    const currentDomain = this.tenantFacade.getCurrentDomainConfig();
    const currentStore = this.tenantFacade.getCurrentStore();

    if (this.isLogin) {
      this.authFacade.login(
        this.authForm.value.email,
        this.authForm.value.password,
        currentDomain?.store_slug,
        currentDomain?.organization_slug,
      );
    } else {
      this.authFacade.registerCustomer({
        ...this.authForm.value,
        store_id: currentStore?.id,
      });
    }
  }
}
