import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-forgot-owner-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <!-- Container: Mobile-first con padding reducido en móvil -->
    <div
      class="min-h-screen flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-[var(--color-background)] to-[rgba(126,215,165,0.1)]"
    >
      <!-- Content wrapper: full-width en mobile, max-width en desktop -->
      <div class="w-full max-w-sm space-y-6">
        <!-- Header: Tamaños reducidos en mobile -->
        <div class="text-center">
          <!-- Logo más pequeño en mobile -->
          <div class="mx-auto flex items-center justify-center gap-2 mb-3">
            <div
              class="w-9 h-9 sm:w-10 sm:h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
            >
              <app-icon name="key" [size]="20" color="white"></app-icon>
            </div>
            <h1 class="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)]">
              Vendix
            </h1>
          </div>

          <!-- Título responsive -->
          <h2 class="text-xl sm:text-2xl font-bold text-[var(--color-text-primary)]">
            Recuperar Contraseña
          </h2>
          <p class="mt-2 mb-2 text-sm text-[var(--color-text-secondary)] px-2">
            Ingresa tu Vlink y email para recibir instrucciones.
          </p>
        </div>

        <!-- Card con form y padding responsive -->
        <app-card class="!mt-6 sm:!mt-8" shadow="md" [animateOnLoad]="true" [responsivePadding]="true">
          <form
            [formGroup]="forgotPasswordForm"
            (ngSubmit)="onSubmit()"
            class="space-y-5"
          >
            <!-- Error alert (compacto) -->
            @if (error) {
              <div class="rounded-lg bg-red-50 p-3 border border-red-200">
                <div class="flex items-start gap-2">
                  <app-icon
                    name="alert-circle"
                    [size]="18"
                    class="text-red-500 flex-shrink-0 mt-0.5"
                  ></app-icon>
                  <p class="text-sm text-red-700">{{ error }}</p>
                </div>
              </div>
            }

            <!-- Inputs con gap reducido -->
            <div class="space-y-4">
              <app-input
                label="V-link"
                formControlName="vlink"
                [control]="forgotPasswordForm.get('vlink')"
                type="text"
                size="md"
                placeholder="mi-organizacion"
              ></app-input>

              <app-input
                label="Email de Propietario"
                formControlName="email"
                [control]="forgotPasswordForm.get('email')"
                type="email"
                size="md"
                placeholder="propietario@empresa.com"
              ></app-input>
            </div>

            <!-- Submit button -->
            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="!forgotPasswordForm.valid || isLoading"
              [loading]="isLoading"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
            >
              @if (isLoading) {
                Enviando...
              } @else {
                Enviar Instrucciones
              }
            </app-button>

            <!-- Back link -->
            <div class="text-center pt-2">
              <a
                routerLink="/auth/login"
                class="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                ← Volver a Iniciar Sesión
              </a>
            </div>
          </form>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: [],
})
export class ForgotOwnerPasswordComponent implements OnInit {
  forgotPasswordForm: FormGroup;
  isLoading = false;
  error: string | null = null;

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router,
  ) {
    this.forgotPasswordForm = this.fb.group({
      vlink: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
    });
  }

  ngOnInit(): void {
    // Subscribe to error changes to display them on screen
    this.authFacade.error$.subscribe((error) => {
      if (error) {
        const errorMessage =
          typeof error === 'string' ? error : extractApiErrorMessage(error);
        this.error = errorMessage;
      } else {
        this.error = null;
      }
    });
  }

  onSubmit(): void {
    if (this.forgotPasswordForm.valid) {
      this.error = null; // Clear any previous errors
      const { vlink, email } = this.forgotPasswordForm.value;
      this.authFacade.forgotOwnerPassword(vlink, email);

      const loadingSubscription = this.authFacade.loading$.subscribe(
        (isLoading) => {
          this.isLoading = isLoading;
        },
      );

      const errorSubscription = this.authFacade.error$.subscribe((error) => {
        if (error) {
          // Error is already handled in ngOnInit
          // Normalize error to handle both string and NormalizedApiPayload types
          const errorMessage =
            typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.toast.error(errorMessage, 'Error al enviar instrucciones');

          // Unsubscribe to prevent memory leaks
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        } else {
          this.toast.success(
            'Si los datos son correctos, recibirás un email con instrucciones.',
          );
          this.router.navigate(['/auth/login']);

          // Unsubscribe on success as well
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        }
      });
    } else {
      this.forgotPasswordForm.markAllAsTouched();
    }
  }
}
