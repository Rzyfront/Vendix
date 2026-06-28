import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import {
  CreatePqrPublicDto,
  PqrService,
  PqrType,
} from '../../../../shared/services/pqr.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Public form to submit a PQR (Petición / Queja / Reclamo).
 *
 * Anonymous, no auth. Validation mirrors the backend DTO
 * (class-validator). On success, navigates to `/pqr/gracias/:ticket_number`.
 *
 * Cross-field validation: phone must look like a valid phone if provided;
 * subject must not be identical to the first line of description (lazy
 * spam guard). Both rules are implemented via the `crossFieldValidator`
 * factory below.
 */
@Component({
  selector: 'app-pqr-submit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent, PublicHeaderComponent],
  templateUrl: './pqr-submit.component.html',
  styleUrls: ['./pqr-submit.component.scss'],
})
export class PqrSubmitComponent {
  private readonly fb = inject(FormBuilder);
  private readonly pqrService = inject(PqrService);
  private readonly router = inject(Router);

  readonly state = signal<SubmitState>('idle');
  readonly serverError = signal<string | null>(null);

  readonly form: FormGroup = this.fb.group(
    {
      pqr_type: this.fb.control<PqrType | null>(null, {
        validators: [Validators.required],
      }),
      name: this.fb.control('', {
        validators: [Validators.required, Validators.minLength(3), Validators.maxLength(255)],
        nonNullable: true,
      }),
      email: this.fb.control('', {
        validators: [Validators.required, Validators.email, Validators.maxLength(255)],
        nonNullable: true,
      }),
      phone: this.fb.control<string | null>(null, {
        validators: [Validators.maxLength(50)],
      }),
      subject: this.fb.control('', {
        validators: [Validators.required, Validators.minLength(5), Validators.maxLength(255)],
        nonNullable: true,
      }),
      description: this.fb.control('', {
        validators: [Validators.required, Validators.minLength(20), Validators.maxLength(5000)],
        nonNullable: true,
      }),
    },
    { validators: [crossFieldValidator()] },
  );

  readonly charCount = computed(() => this.form.controls['description'].value.length);
  readonly isReady = computed(() => this.state() === 'idle');

  setType(type: PqrType) {
    this.form.controls['pqr_type'].setValue(type);
    this.form.controls['pqr_type'].markAsTouched();
  }

  hasError(controlName: string, error: string): boolean {
    const ctrl = this.form.get(controlName);
    return !!(ctrl?.touched && ctrl?.hasError(error));
  }

  /**
   * "Cancelar" — go back to the help center (the entry point of
   * the form). The submit handler does its own redirect on
   * success, so this only handles the user-initiated exit.
   */
  goBack(): void {
    this.router.navigate(['/ayuda']);
  }

  hasFormError(error: string): boolean {
    return !!(this.form.touched && this.form.hasError(error));
  }

  /**
   * Translate any backend error into something the visitor can
   * actually act on. Three categories of failure:
   *
   *  1. Network / connectivity → 'No pudimos conectar con el
   *     servidor. Verifica tu conexión e intenta de nuevo.'
   *  2. Validation error from the backend (400) → surface the
   *     server's message if it looks user-friendly, otherwise
   *     fall back to a generic validation copy.
   *  3. Server error (5xx) → don't leak the raw "Internal
   *     server error" — explain that the team has been notified
   *     (which is the case because the listener also pings
   *     admin@vendix.online on every crash via Sentry-like
   *     logging) and suggest retrying.
   */
  private humanizeError(err: any): string {
    const status = err?.status ?? err?.error?.statusCode ?? 0;
    const backendMsg = err?.error?.message as string | undefined;

    // Network / connection issues
    if (status === 0 || err?.statusText === 'Unknown Error') {
      return 'No pudimos conectar con el servidor. Verifica tu conexión a internet e intenta de nuevo.';
    }

    // Validation: trust the backend's message only if it looks
    // like a sentence (more than 20 chars, no curl brackets, no
    // `PrismaClient` / `e.message` patterns).
    if (status >= 400 && status < 500 && backendMsg) {
      if (backendMsg.length > 20 && !backendMsg.includes('PrismaClient') && !backendMsg.startsWith('e.')) {
        return backendMsg;
      }
    }

    // 5xx and everything we couldn't classify: never leak the raw
    // 'Internal server error'. Reassure the user that the team
    // will see it.
    if (status >= 500) {
      return 'No pudimos enviar tu PQRS en este momento. El equipo de soporte ya fue notificado — intenta de nuevo en unos minutos o escríbenos directamente a soporte@vendix.online.';
    }

    // Fallback
    return 'No pudimos enviar tu PQRS. Por favor intenta de nuevo o escríbenos a soporte@vendix.online.';
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const dto: CreatePqrPublicDto = {
      pqr_type: this.form.controls['pqr_type'].value as PqrType,
      name: this.form.controls['name'].value.trim(),
      email: this.form.controls['email'].value.trim().toLowerCase(),
      phone: this.form.controls['phone'].value?.trim() || undefined,
      subject: this.form.controls['subject'].value.trim(),
      description: this.form.controls['description'].value.trim(),
    };
    this.state.set('submitting');
    this.serverError.set(null);

    this.pqrService.createPublic(dto).subscribe({
      next: (res) => {
        if (res.success) {
          this.state.set('success');
          this.router.navigate(['/pqr/gracias', res.data.ticket_number]);
        } else {
          this.state.set('error');
          this.serverError.set('La respuesta del servidor no fue exitosa.');
        }
      },
      error: (err) => {
        this.state.set('error');
        this.serverError.set(this.humanizeError(err));
      },
    });
  }
}

/**
 * Cross-field validation rules. Runs when any field in the group changes.
 * Returns a validator error map when the form is invalid.
 *
 * Rules:
 * - `subjectEqualsDescription`: subject must not equal (case-insensitive,
 *   trimmed) the first line of description — catches a common lazy-spam
 *   pattern where users paste their subject into the description verbatim.
 * - `phoneFormat`: phone, if provided, must be at least 7 digits long
 *   (digits-only count). Allows +, spaces, dashes, parentheses.
 */
function crossFieldValidator() {
  return (group: FormGroup): Record<string, boolean> | null => {
    const errors: Record<string, boolean> = {};

    const subject = (group.get('subject')?.value ?? '').toString().trim();
    const description = (group.get('description')?.value ?? '').toString().trim();
    if (
      subject &&
      description &&
      subject.toLowerCase() ===
        description.split('\n')[0].trim().toLowerCase().slice(0, subject.length)
    ) {
      errors['subjectEqualsDescription'] = true;
    }

    const phone = (group.get('phone')?.value ?? '').toString().trim();
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7) {
        errors['phoneFormat'] = true;
      }
    }

    return Object.keys(errors).length ? errors : null;
  };
}