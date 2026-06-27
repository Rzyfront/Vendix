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
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
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

  hasFormError(error: string): boolean {
    return !!(this.form.touched && this.form.hasError(error));
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
        this.serverError.set(
          err?.error?.message ??
            'No pudimos enviar tu PQRS. Intenta de nuevo en un momento.',
        );
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