import { Component, DestroyRef, model, input, output, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  ModalComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-verify-email-modal',
  standalone: true,
  imports: [FormsModule, ButtonComponent, ModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'md'"
      title="Verificar Email"
      [subtitle]="'Enviar enlace de verificación a ' + (user()?.email || '')"
    >
      <div class="space-y-4">
        <p class="text-sm text-[var(--color-text-secondary)]">
          Se enviará un enlace de verificación al correo electrónico del usuario.
          El usuario deberá hacer clic en el enlace para confirmar su dirección de email.
        </p>

        @if (user()?.email_verified) {
          <div class="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p class="text-sm text-green-700 dark:text-green-400">
              Este usuario ya tiene el email verificado.
            </p>
          </div>
        }

        <div class="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
          <p class="text-sm text-blue-700 dark:text-blue-400">
            <strong>Email:</strong> {{ user()?.email }}
          </p>
        </div>
      </div>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose()"
          [disabled]="isSending()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSendVerification()"
          [loading]="isSending()"
          [disabled]="user()?.email_verified || isSending()"
        >
          Enviar Enlace de Verificación
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class VerifyEmailModalComponent {
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly user = input<User | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onVerified = output<void>();

  readonly isSending = signal(false);

  onClose(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
  }

  onSendVerification(): void {
    const user = this.user();
    if (!user || user.email_verified || this.isSending()) return;

    this.isSending.set(true);

    this.usersService
      .verifyEmail(user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSending.set(false);
          this.toastService.success(
            'Enlace de verificación enviado exitosamente',
          );
          this.onVerified.emit();
          this.onClose();
        },
        error: (err: unknown) => {
          this.isSending.set(false);
          const message = extractApiErrorMessage(err);
          this.toastService.error(message);
        },
      });
  }
}
