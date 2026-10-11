import { Component, DestroyRef, inject, model, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { QuotationProfile, QuotationProfileConfig, SaveQuotationProfileDto } from '../../interfaces/quotation-profile.interface';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';

@Component({
  selector: 'app-quotation-profile-form-modal',
  standalone: true,
  imports: [ReactiveFormsModule, ModalComponent, ButtonComponent, InputComponent, TextareaComponent],
  template: `
    <app-modal [(isOpen)]="isOpen" [title]="profile() ? 'Editar perfil de cotización' : 'Nuevo perfil de cotización'" subtitle="Configuración comercial de cotizaciones; no determina el régimen fiscal." size="lg" [dialog]="true" [closeOnEscape]="!isSaving()" [showCloseButton]="!isSaving()">
      <form [formGroup]="form" (ngSubmit)="save()" class="space-y-4">
        <app-input label="Nombre *" formControlName="name" [maxlength]="150" placeholder="Ej. Obra residencial" [error]="nameError()"></app-input>
        <section class="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
          <h3 class="font-semibold">Porcentajes comerciales (opcionales)</h3>
          <p class="text-sm text-[var(--color-text-secondary)]">Estos valores son parámetros del perfil, no un cálculo ni una clasificación tributaria.</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <app-input label="Administración (%)" type="number" formControlName="admin_percent" [min]="0" [max]="100" [step]="0.01" [error]="fieldError('admin_percent')"></app-input>
            <app-input label="Imprevistos (%)" type="number" formControlName="contingency_percent" [min]="0" [max]="100" [step]="0.01" [error]="fieldError('contingency_percent')"></app-input>
            <app-input label="Utilidad (%)" type="number" formControlName="profit_percent" [min]="0" [max]="100" [step]="0.01" [error]="fieldError('profit_percent')"></app-input>
          </div>
        </section>
        <app-input label="Vigencia (días)" type="number" formControlName="validity_days" [min]="0" [step]="1" [error]="fieldError('validity_days')"></app-input>
        <app-textarea label="Condiciones de pago" formControlName="payment_terms" [rows]="3" [maxlength]="500" placeholder="Opcional"></app-textarea>
        <app-textarea label="Notas" formControlName="notes" [rows]="3" [maxlength]="2000" placeholder="Opcional"></app-textarea>
        @if (errorMessage()) { <p class="text-sm text-[var(--color-error)]" role="alert">{{ errorMessage() }}</p> }
      </form>
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="outline" type="button" [disabled]="isSaving()" (clicked)="close()">Cancelar</app-button>
        <app-button variant="primary" type="button" [loading]="isSaving()" [disabled]="form.invalid || isSaving()" (clicked)="save()">{{ profile() ? 'Guardar cambios' : 'Crear perfil' }}</app-button>
      </div>
    </app-modal>
  `,
})
export class QuotationProfileFormModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly profiles = inject(QuotationProfilesService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model(false);
  readonly profile = signal<QuotationProfile | null>(null);
  readonly saved = output<void>();
  readonly isSaving = signal(false);
  readonly errorMessage = signal('');
  readonly form = this.fb.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(150)]),
    admin_percent: this.fb.control<number | string | null>(null, [Validators.min(0), Validators.max(100), Validators.pattern(/^\d+(?:\.\d*)?$|^\.\d+$/)]),
    contingency_percent: this.fb.control<number | string | null>(null, [Validators.min(0), Validators.max(100), Validators.pattern(/^\d+(?:\.\d*)?$|^\.\d+$/)]),
    profit_percent: this.fb.control<number | string | null>(null, [Validators.min(0), Validators.max(100), Validators.pattern(/^\d+(?:\.\d*)?$|^\.\d+$/)]),
    validity_days: this.fb.control<number | string | null>(null, [Validators.min(0), Validators.pattern(/^\d+$/)]),
    payment_terms: this.fb.control<string | null>('', [Validators.maxLength(500)]),
    notes: this.fb.control<string | null>('', [Validators.maxLength(2000)]),
  });

  open(profile: QuotationProfile | null = null): void {
    this.errorMessage.set('');
    this.form.reset({
      name: profile?.name ?? '',
      admin_percent: profile?.current_config?.admin_percent ?? null,
      contingency_percent: profile?.current_config?.contingency_percent ?? null,
      profit_percent: profile?.current_config?.profit_percent ?? null,
      validity_days: profile?.current_config?.validity_days ?? null,
      payment_terms: profile?.current_config?.payment_terms ?? '',
      notes: profile?.current_config?.notes ?? '',
    });
    this.profile.set(profile);
    this.isOpen.set(true);
  }

  close(): void {
    if (this.isSaving()) return;
    this.isOpen.set(false);
  }

  nameError(): string {
    const control = this.form.controls.name;
    if (!control.touched && !control.dirty) return '';
    if (control.hasError('required')) return 'El nombre es obligatorio.';
    if (control.hasError('maxlength')) return 'Máximo 150 caracteres.';
    return '';
  }

  fieldError(key: 'admin_percent' | 'contingency_percent' | 'profit_percent' | 'validity_days'): string {
    const control = this.form.controls[key];
    if (!control.touched && !control.dirty) return '';
    if (control.hasError('min') || control.hasError('max')) return key === 'validity_days' ? 'Debe ser un entero mayor o igual a 0.' : 'Usa un valor entre 0 y 100.';
    if (control.hasError('pattern')) return key === 'validity_days' ? 'Debe ser un entero mayor o igual a 0.' : 'Introduce un número finito entre 0 y 100.';
    return '';
  }

  save(): void {
    if (this.isSaving()) return;
    const profile = this.profile();
    if (profile && (!this.auth.hasPermission('store:quotations:read:one') || !this.auth.hasPermission('store:quotations:update'))) {
      this.errorMessage.set('No tienes permiso para editar este perfil.');
      return;
    }
    if (!profile && !this.auth.hasPermission('store:quotations:create')) {
      this.errorMessage.set('No tienes permiso para crear perfiles.');
      return;
    }
    const normalizedName = this.form.controls.name.value.replace(/\s+/g, ' ').trim();
    this.form.controls.name.setValue(normalizedName);
    if (!normalizedName) this.form.controls.name.setErrors({ required: true });
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const value = this.form.getRawValue();
    const config: QuotationProfileConfig = {};
    for (const key of ['admin_percent', 'contingency_percent', 'profit_percent', 'validity_days'] as const) {
      const raw = value[key];
      if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) continue;
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) config[key] = numeric;
    }
    const paymentTerms = value.payment_terms?.trim();
    const notes = value.notes?.trim();
    if (paymentTerms) config.payment_terms = paymentTerms;
    if (notes) config.notes = notes;
    const dto: SaveQuotationProfileDto = { name: value.name.replace(/\s+/g, ' ').trim(), config };
    if (!dto.name) { this.form.controls.name.setErrors({ required: true }); return; }
    this.errorMessage.set('');
    this.isSaving.set(true);
    const request$ = profile ? this.profiles.update(profile.id, dto) : this.profiles.create(dto);
    request$.pipe(finalize(() => this.isSaving.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.isOpen.set(false); this.saved.emit(); },
      error: (error) => this.errorMessage.set(extractApiErrorMessage(error)),
    });
  }
}
