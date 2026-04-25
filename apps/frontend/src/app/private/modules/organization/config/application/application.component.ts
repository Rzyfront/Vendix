import { Component, effect, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InputComponent,
  ButtonComponent,
  CardComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  AlertBannerComponent,
  IconComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';
import { OrganizationSettings, OrganizationBranding } from '../../../../../core/models/organization.model';

@Component({
  selector: 'app-application',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    ButtonComponent,
    CardComponent,
    SelectorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Configuración de la aplicación"
        subtitle="Branding, idioma y valores por defecto"
        icon="sliders"
        [showBackButton]="true"
        backRoute="/organization/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando configuración..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <app-card [responsivePadding]="true">
            @if (settings()) {
              <form [formGroup]="form" class="space-y-6">
                <!-- Branding Section -->
                <div class="border-b border-gray-200 pb-6">
                  <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                    <app-icon name="palette" size="18"></app-icon>
                    Branding
                  </h3>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-input
                      label="Nombre de la organización"
                      placeholder="Mi Organización"
                      formControlName="name"
                      [required]="true"
                    ></app-input>

                    <app-input
                      label="Color primario (hex)"
                      placeholder="#3B82F6"
                      formControlName="primary_color"
                    ></app-input>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <app-input
                      label="Color secundario (hex)"
                      placeholder="#6366F1"
                      formControlName="secondary_color"
                    ></app-input>

                    <app-input
                      label="Color de acento (hex)"
                      placeholder="#8B5CF6"
                      formControlName="accent_color"
                    ></app-input>

                    <app-input
                      label="Color de fondo (hex)"
                      placeholder="#FFFFFF"
                      formControlName="background_color"
                    ></app-input>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <app-input
                      label="Color de texto (hex)"
                      placeholder="#111827"
                      formControlName="text_color"
                    ></app-input>

                    <app-input
                      label="Color secundario de texto (hex)"
                      placeholder="#6B7280"
                      formControlName="text_secondary_color"
                    ></app-input>
                  </div>
                </div>

                <!-- Language & Defaults Section -->
                <div>
                  <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                    <app-icon name="globe" size="18"></app-icon>
                    Idioma y region
                  </h3>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <app-selector
                      label="Idioma"
                      [options]="languageOptions"
                      formControlName="language"
                      placeholder="Seleccionar idioma"
                    ></app-selector>

                    <app-selector
                      label="Zona horaria"
                      [options]="timezoneOptions"
                      formControlName="timezone"
                      placeholder="Seleccionar zona horaria"
                    ></app-selector>

                    <app-selector
                      label="Formato de fecha"
                      [options]="dateFormatOptions"
                      formControlName="date_format"
                      placeholder="Seleccionar formato"
                    ></app-selector>

                    <app-selector
                      label="Formato de moneda"
                      [options]="currencyFormatOptions"
                      formControlName="currency_format"
                      placeholder="Seleccionar formato"
                    ></app-selector>
                  </div>
                </div>

                <!-- Save Button -->
                <div class="flex justify-end pt-4 border-t border-gray-200">
                  <app-button
                    variant="primary"
                    [loading]="saving()"
                    [disabled]="form.pristine || form.invalid"
                    (clicked)="onSave()"
                  >
                    Guardar cambios
                  </app-button>
                </div>
              </form>
            }
          </app-card>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class ApplicationComponent {
  private settingsService = inject(OrganizationSettingsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly settings = signal<OrganizationSettings | null>(null);

  form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    primary_color: new FormControl('#3B82F6', { nonNullable: true }),
    secondary_color: new FormControl('#6366F1', { nonNullable: true }),
    accent_color: new FormControl('#8B5CF6', { nonNullable: true }),
    background_color: new FormControl('#FFFFFF', { nonNullable: true }),
    surface_color: new FormControl('#F9FAFB', { nonNullable: true }),
    text_color: new FormControl('#111827', { nonNullable: true }),
    text_secondary_color: new FormControl('#6B7280', { nonNullable: true }),
    text_muted_color: new FormControl('#9CA3AF', { nonNullable: true }),
    language: new FormControl('es', { nonNullable: true }),
    timezone: new FormControl('America/Bogota', { nonNullable: true }),
    date_format: new FormControl('DD/MM/YYYY', { nonNullable: true }),
    currency_format: new FormControl('COP', { nonNullable: true }),
  });

  readonly languageOptions: SelectorOption[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
  ];

  readonly timezoneOptions: SelectorOption[] = [
    { value: 'America/Bogota', label: 'Bogotá (GMT-5)' },
    { value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)' },
    { value: 'America/New_York', label: 'Nueva York (GMT-5)' },
    { value: 'America/Los_Angeles', label: 'Los Ángeles (GMT-8)' },
    { value: 'Europe/Madrid', label: 'Madrid (GMT+1)' },
  ];

  readonly dateFormatOptions: SelectorOption[] = [
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2025)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2025)' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2025-12-31)' },
  ];

  readonly currencyFormatOptions: SelectorOption[] = [
    { value: 'COP', label: 'COP - Peso colombiano' },
    { value: 'USD', label: 'USD - Dólar estadounidense' },
    { value: 'EUR', label: 'EUR - Euro' },
    { value: 'MXN', label: 'MXN - Peso mexicano' },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.settings.set(settings);
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings?.branding) {
        this.form.patchValue(
          {
            name: settings.branding.name || '',
            primary_color: settings.branding.primary_color || '#3B82F6',
            secondary_color: settings.branding.secondary_color || '#6366F1',
            accent_color: settings.branding.accent_color || '#8B5CF6',
            background_color: settings.branding.background_color || '#FFFFFF',
            surface_color: settings.branding.surface_color || '#F9FAFB',
            text_color: settings.branding.text_color || '#111827',
            text_secondary_color: settings.branding.text_secondary_color || '#6B7280',
            text_muted_color: settings.branding.text_muted_color || '#9CA3AF',
          },
          { emitEvent: false },
        );
        this.form.markAsPristine();
      }
    });
  }

  onSave(): void {
    if (this.form.pristine || this.form.invalid || this.saving()) return;

    const formValue = this.form.value;
    const branding: Partial<OrganizationBranding> = {
      name: formValue.name as string,
      primary_color: formValue.primary_color as string,
      secondary_color: formValue.secondary_color as string,
      accent_color: formValue.accent_color as string,
      background_color: formValue.background_color as string,
      surface_color: formValue.surface_color as string,
      text_color: formValue.text_color as string,
      text_secondary_color: formValue.text_secondary_color as string,
      text_muted_color: formValue.text_muted_color as string,
    };

    this.settingsService.saveBranding(branding).subscribe({
      next: () => this.form.markAsPristine(),
      error: () => {},
    });
  }

  dismissError(): void {
    this.error.set(null);
  }
}