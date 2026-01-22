import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  OnChanges,
  DestroyRef,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store';
import { TenantFacade } from '../../../../../core/store';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
  ],
  template: `
    <app-modal [isOpen]="isOpen" (closed)="onClose()" size="sm" title=" " [overlayCloseButton]="true">
      <!-- Custom Header with Logo -->
      <div
        slot="header"
        class="flex flex-col items-center text-center w-full py-2"
      >
        <!-- Store Logo -->
        <div class="mb-4">
          @if (storeLogo) {
            <img
              [src]="storeLogo"
              [alt]="storeName"
              class="h-12 w-auto object-contain"
            />
          } @else {
            <div class="flex items-center gap-2 text-[var(--color-primary)]">
              <app-icon name="shopping-bag" [size]="32"></app-icon>
              <span
                class="text-xl font-bold text-[var(--color-text-primary)]"
                >{{ storeName }}</span
              >
            </div>
          }
        </div>
        <!-- Title -->
        <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
          {{ isLogin ? 'Iniciar Sesion' : 'Crear Cuenta' }}
        </h3>
        <p class="text-sm text-[var(--color-text-secondary)] mt-1">
          {{
            isLogin
              ? 'Ingresa tus credenciales para continuar'
              : 'Registrate para realizar tu compra'
          }}
        </p>
      </div>

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

        <!-- Error Message -->
        @if (errorMessage) {
          <div
            class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"
          >
            {{ errorMessage }}
          </div>
        }

        <form [formGroup]="authForm" (ngSubmit)="onSubmit()" class="space-y-4">
          @if (!isLogin) {
            <div class="grid grid-cols-2 gap-4">
              <app-input
                label="Nombre"
                placeholder="Ej. Juan"
                formControlName="first_name"
              ></app-input>
              <app-input
                label="Apellido"
                placeholder="Ej. Perez"
                formControlName="last_name"
              ></app-input>
            </div>
          }

          <app-input
            label="Correo Electronico"
            type="email"
            placeholder="tu@email.com"
            formControlName="email"
          ></app-input>

          <app-input
            label="Contrasena"
            type="password"
            placeholder="********"
            formControlName="password"
          ></app-input>
          @if (!isLogin && authForm.get('password')?.touched) {
            <p class="text-[10px] text-[var(--color-text-secondary)] mt-1">
              Mínimo 8 caracteres y al menos un carácter especial (ej. @, #, !).
            </p>
          }

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
export class AuthModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() initialMode: 'login' | 'register' = 'login';
  @Input() storeLogo: string | null = null;
  @Input() storeName = 'Tienda';
  @Output() closed = new EventEmitter<void>();

  isLogin = true;
  errorMessage: string | null = null;

  private fb = inject(FormBuilder);
  private authFacade = inject(AuthFacade);
  private tenantFacade = inject(TenantFacade);
  private destroyRef = inject(DestroyRef);

  loading$ = this.authFacade.loading$;
  authForm: FormGroup;

  constructor() {
    // Initialize form in constructor
    this.authForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(/.*[^A-Za-z0-9].*/), // Al menos un carácter especial
        ],
      ],
      first_name: [''],
      last_name: [''],
    });

    // Auto-close modal on successful authentication (using takeUntilDestroyed)
    this.authFacade.isAuthenticated$
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((isAuth) => isAuth && this.isOpen),
      )
      .subscribe(() => {
        this.onClose();
      });

    // Listen for auth errors
    this.authFacade.error$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((error) => {
        if (error && this.isOpen) {
          this.errorMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialMode']) {
      this.isLogin = this.initialMode === 'login';
      this.updateValidators();
    }
    // Clear error when modal opens
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage = null;
    }
  }

  switchMode(isLogin: boolean): void {
    this.isLogin = isLogin;
    this.errorMessage = null;
    this.updateValidators();
  }

  updateValidators(): void {
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

  onClose(): void {
    this.isOpen = false;
    this.errorMessage = null;
    this.closed.emit();
    this.authForm.reset();
  }

  onSubmit(): void {
    if (this.authForm.invalid) {
      this.authForm.markAllAsTouched();
      return;
    }

    // Clear previous errors
    this.errorMessage = null;

    const currentDomain = this.tenantFacade.getCurrentDomainConfig();
    const currentStore = this.tenantFacade.getCurrentStore();

    if (this.isLogin) {
      // Use the dedicated loginCustomer for e-commerce
      const storeId = this.tenantFacade.getCurrentStoreId();

      if (!storeId) {
        this.errorMessage =
          'No se pudo identificar la tienda. Por favor, recarga la página.';
        return;
      }

      this.authFacade.loginCustomer(
        this.authForm.value.email,
        this.authForm.value.password,
        storeId,
      );
    } else {
      // Get values from form
      const { email, password, first_name, last_name } = this.authForm.value;

      // Get store_id safely using the new robust method
      const storeId = this.tenantFacade.getCurrentStoreId();

      if (!storeId) {
        this.errorMessage =
          'No se pudo identificar la tienda. Por favor, recarga la página.';
        return;
      }

      // Explicitly construct the payload to avoid any extra properties like 'type'
      const payload = {
        email,
        password,
        first_name,
        last_name,
        store_id: storeId,
      };

      this.authFacade.registerCustomer(payload);
    }
  }
}
