import { Component, model, input, output, signal, inject } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
} from '../../../../../shared/components/index';
import { UsersService } from '../services/users.service';
import { User } from '../interfaces/user.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

@Component({
  selector: 'app-reset-password-modal',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, ButtonComponent, ModalComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [size]="'md'"
      title="Restablecer Contraseña"
      [subtitle]="'Asignar nueva contraseña para ' + (user()?.username || '')"
    >
      <form [formGroup]="passwordForm" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <p class="text-sm text-[var(--color-text-secondary)]">
            La nueva contraseña será asignada directamente. El usuario deberá cambiarla
            en su próximo inicio de sesión.
          </p>

          <app-input
            formControlName="new_password"
            label="Nueva Contraseña"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="passwordForm.get('new_password')"
            helpText="Mínimo 8 caracteres, debe incluir mayúscula, minúscula, número y carácter especial"
          ></app-input>

          <app-input
            formControlName="confirm_password"
            label="Confirmar Contraseña"
            type="password"
            placeholder="••••••••••"
            [required]="true"
            [control]="passwordForm.get('confirm_password')"
          ></app-input>

          @if (passwordMismatch()) {
            <p class="text-xs text-red-500">Las contraseñas no coinciden</p>
          }
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose()"
          [disabled]="isResetting()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="isResetting()"
          [disabled]="passwordForm.invalid || passwordMismatch() || isResetting()"
        >
          Restablecer Contraseña
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: block; }
  `],
})
export class ResetPasswordModalComponent {
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);

  readonly user = input<User | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly onReset = output<void>();

  readonly isResetting = signal(false);
  readonly passwordMismatch = signal(false);

  passwordForm: FormGroup;

  constructor() {
    this.passwordForm = this.fb.group({
      new_password: [
        '',
        [
          Validators.required,
          Validators.minLength(8),
          Validators.pattern(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
          ),
        ],
      ],
      confirm_password: ['', [Validators.required]],
    });

    this.passwordForm.valueChanges.subscribe(() => {
      const val = this.passwordForm.value;
      this.passwordMismatch.set(
        val.new_password !== val.confirm_password && val.confirm_password.length > 0
      );
    });
  }

  onClose(): void {
    this.isOpen.set(false);
    this.isOpenChange.emit(false);
    this.passwordForm.reset();
  }

  onSubmit(): void {
    const user = this.user();
    if (this.passwordForm.invalid || this.passwordMismatch() || !user) return;

    this.isResetting.set(true);

    this.usersService.resetPassword(user.id, {
      new_password: this.passwordForm.value.new_password,
      confirm_password: this.passwordForm.value.confirm_password,
    }).subscribe({
      next: () => {
        this.isResetting.set(false);
        this.toastService.success('Contraseña restablecida exitosamente');
        this.onReset.emit();
        this.onClose();
      },
      error: (err: unknown) => {
        this.isResetting.set(false);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message);
      },
    });
  }
}