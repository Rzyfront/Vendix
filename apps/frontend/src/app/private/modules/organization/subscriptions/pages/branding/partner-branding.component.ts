import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CardComponent,
  ButtonComponent,
  InputComponent,
  InputsearchComponent,
  ToggleComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { environment } from '../../../../../../../environments/environment';
import { HttpClient } from '@angular/common/http';

interface BrandingConfig {
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  company_name: string;
  support_email: string;
  custom_domain: string | null;
  show_vendix_branding: boolean;
}

@Component({
  selector: 'app-partner-branding',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    InputComponent,
    ToggleComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold text-text-primary">Branding Partner</h1>
          <p class="text-sm text-text-secondary">Personaliza la experiencia de tus clientes</p>
        </div>
        <app-button variant="primary" [loading]="saving()" (clicked)="saveBranding()">
          <app-icon name="save" [size]="16" slot="icon"></app-icon>
          Guardar Cambios
        </app-button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <app-card>
          <div class="p-4 space-y-4">
            <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Identidad</h3>
            <form [formGroup]="form" class="space-y-4">
              <app-input
                label="Nombre de la Empresa"
                formControlName="company_name"
                [control]="form.get('company_name')"
                [required]="true"
              ></app-input>
              <app-input
                label="Email de Soporte"
                formControlName="support_email"
                [control]="form.get('support_email')"
                [required]="true"
              ></app-input>
              <app-input
                label="Dominio Personalizado"
                formControlName="custom_domain"
                [control]="form.get('custom_domain')"
              ></app-input>
            </form>
          </div>
        </app-card>

        <app-card>
          <div class="p-4 space-y-4">
            <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Colores</h3>
            <form [formGroup]="form" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1">Color Primario</label>
                <div class="flex items-center gap-3">
                  <input
                    type="color"
                    formControlName="primary_color"
                    class="w-12 h-12 rounded-lg cursor-pointer border border-border"
                  />
                  <input
                    type="text"
                    formControlName="primary_color"
                    class="flex-1 px-3 py-2 border border-border rounded-input text-sm"
                  />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1">Color Secundario</label>
                <div class="flex items-center gap-3">
                  <input
                    type="color"
                    formControlName="secondary_color"
                    class="w-12 h-12 rounded-lg cursor-pointer border border-border"
                  />
                  <input
                    type="text"
                    formControlName="secondary_color"
                    class="flex-1 px-3 py-2 border border-border rounded-input text-sm"
                  />
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-text-primary">Mostrar branding Vendix</span>
                <app-toggle formControlName="show_vendix_branding"></app-toggle>
              </div>
            </form>
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class PartnerBrandingComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private toastService = inject(ToastService);

  readonly saving = signal(false);

  form = this.fb.group({
    company_name: ['', Validators.required],
    support_email: ['', [Validators.required, Validators.email]],
    custom_domain: [''],
    primary_color: ['#3B82F6', Validators.required],
    secondary_color: ['#10B981', Validators.required],
    logo_url: [''],
    show_vendix_branding: [true],
  });

  ngOnInit(): void {
    this.loadBranding();
  }

  private loadBranding(): void {
    this.http.get<{ success: boolean; data: BrandingConfig }>(`${environment.apiUrl}/organization/reseller/branding`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.form.patchValue(res.data);
          }
        },
      });
  }

  saveBranding(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.http.put(`${environment.apiUrl}/organization/reseller/branding`, this.form.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Branding actualizado');
          this.saving.set(false);
        },
        error: () => {
          this.toastService.error('Error al guardar branding');
          this.saving.set(false);
        },
      });
  }
}
