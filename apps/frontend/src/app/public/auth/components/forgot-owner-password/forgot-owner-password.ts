import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { InputComponent } from '../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-forgot-owner-password',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    CardComponent,
    InputComponent,
    ButtonComponent
  ],
  template: `
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-[var(--color-background)] to-[rgba(126, 215, 165, 0.1)]">
      <div class="max-w-sm w-full space-y-8">
        <!-- Header section with logo and title -->
        <div class="text-center my-3">
          <div class="mx-auto h-16 w-16 bg-[var(--color-primary)] rounded-full flex items-center justify-center mb-4">
            <span class="text-white font-bold text-xl">V</span>
          </div>
          <h2 class="mt-6 text-2xl font-extrabold text-[var(--color-text-primary)]">
            Recuperar Contraseña
          </h2>
          <p class="mt-2 text-sm text-[var(--color-text-secondary)]">
            Ingresa el Vlink de tu organización y tu email para recibir instrucciones.
          </p>
        </div>

        <!-- Card with form -->
        <app-card shadow="md" [animateOnLoad]="true" class="mt-8">
          <form [formGroup]="forgotPasswordForm" (ngSubmit)="onSubmit()" class="space-y-8">
            <!-- Error message display -->
            <div *ngIf="error" class="rounded-md bg-[rgba(239, 68, 68, 0.1)] p-4 border border-[rgba(239, 68, 68, 0.2)]">
              <div class="flex">
                <div class="flex-shrink-0">
                  <svg class="h-5 w-5 text-[var(--color-destructive)]" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                  </svg>
                </div>
                <div class="ml-3">
                  <h3 class="text-sm font-medium text-[var(--color-destructive)]">
                    {{ error }}
                  </h3>
                </div>
              </div>
            </div>

            <div>
              <app-input
                label="Vlink"
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

            <app-button
              type="submit"
              variant="primary"
              size="md"
              [disabled]="!forgotPasswordForm.valid || isLoading"
              [loading]="isLoading"
              [fullWidth]="true"
              [showTextWhileLoading]="true"
              class="mt-4 w-full">
              @if (isLoading) {
                Enviando instrucciones...
              } @else {
                Enviar Instrucciones
              }
            </app-button>

            <!-- Back to login link -->
            <div class="flex justify-center mt-4">
              <div class="text-sm">
                <a
                  routerLink="/auth/login"
                  class="font-medium text-[var(--color-primary)] hover:text-[var(--color-secondary)]">
                  Volver a Iniciar Sesión
                </a>
              </div>
            </div>
          </form>
        </app-card>
      </div>
    </div>
  `,
  styleUrls: []
})
export class ForgotOwnerPasswordComponent implements OnInit {
  forgotPasswordForm: FormGroup;
  isLoading = false;
  error: string | null = null;

  private toast = inject(ToastService);

  constructor(
    private fb: FormBuilder,
    private authFacade: AuthFacade,
    private router: Router
  ) {
    this.forgotPasswordForm = this.fb.group({
      vlink: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit(): void {
    // Subscribe to error changes to display them on screen
    this.authFacade.error$.subscribe(error => {
      if (error) {
        const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error);
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

      const loadingSubscription = this.authFacade.loading$.subscribe(isLoading => {
        this.isLoading = isLoading;
      });

      const errorSubscription = this.authFacade.error$.subscribe(error => {
        if (error) {
          // Error is already handled in ngOnInit
          // Normalize error to handle both string and NormalizedApiPayload types
          const errorMessage = typeof error === 'string' ? error : extractApiErrorMessage(error);
          this.toast.error(errorMessage, 'Error al enviar instrucciones');
          
          // Unsubscribe to prevent memory leaks
          loadingSubscription.unsubscribe();
          errorSubscription.unsubscribe();
        } else {
          this.toast.success('Si los datos son correctos, recibirás un email con instrucciones.');
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