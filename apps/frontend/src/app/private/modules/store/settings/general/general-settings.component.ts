import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreSettingsService } from './services/store-settings.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { GeneralSettingsForm } from './components/general-settings-form/general-settings-form.component';
import { InventorySettingsForm } from './components/inventory-settings-form/inventory-settings-form.component';
import { NotificationsSettingsForm } from './components/notifications-settings-form/notifications-settings-form.component';
import { PosSettingsForm } from './components/pos-settings-form/pos-settings-form.component';
import { ReceiptsSettingsForm } from './components/receipts-settings-form/receipts-settings-form.component';
import { AppSettingsForm } from './components/app-settings-form/app-settings-form.component';
import { LucideAngularModule } from "lucide-angular";
import { IconComponent } from '../../../../../shared/components/index';


@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Configuraciones generales</h1>
        <p class="text-gray-600">
         Configurar la información básica y las preferencias de la tienda
        </p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"
          >
            <svg
              class="w-8 h-8 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              ></path>
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            General Configuration
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
            La configuración general está en desarrollo. 
            Podrás configurar las preferencias de la tienda aquí.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  private settings_service = inject(StoreSettingsService);
  private toast_service = inject(ToastService);

  settings: StoreSettings = {} as StoreSettings;
  isLoading = true;
  isSaving = false;
  isAutoSaving = false;
  hasUnsavedChanges = false;
  lastSaved: Date | null = null;
  saveError: string | null = null;

  showTemplates = false;
  templates: any[] = [];

  ngOnInit() {
    this.loadSettings();
  }

  loadSettings() {
    this.settings_service.getSettings().subscribe({
      next: (response) => {
        this.settings = response.data;
        this.isLoading = false;
        this.hasUnsavedChanges = false;
      },
      error: (error) => {
        console.error('Error loading settings:', error);
        this.toast_service.error('Error loading settings');
        this.isLoading = false;
      },
    });
  }

  loadTemplates() {
    this.settings_service.getSystemTemplates().subscribe({
      next: (response) => {
        this.templates = response.data;
      },
      error: (error) => {
        console.error('Error loading templates:', error);
        this.toast_service.error('Error loading templates');
      },
    });
  }

  onSectionChange(section: keyof StoreSettings, new_settings: any) {
    this.settings = {
      ...this.settings,
      [section]: new_settings,
    };
    this.hasUnsavedChanges = true;
    this.lastSaved = null;
    this.saveError = null;

    // Suscribirse para recibir feedback del auto-guardado
    this.settings_service.saveSettings({ [section]: new_settings }).subscribe({
      next: (response) => {
        this.hasUnsavedChanges = false;
        this.lastSaved = new Date();
        this.isAutoSaving = false;
        this.toast_service.success('Cambios guardados automáticamente');
      },
      error: (error) => {
        this.hasUnsavedChanges = true;
        this.saveError = error.message || 'Error al guardar cambios';
        this.isAutoSaving = false;
        this.toast_service.error('Error al guardar cambios');
      }
    });
  }

  saveAllSettings() {
    this.isSaving = true;
    this.settings_service.saveSettingsNow(this.settings).subscribe({
      next: () => {
        this.isSaving = false;
        this.hasUnsavedChanges = false;
        this.lastSaved = new Date();
        this.toast_service.success('Configuración guardada');
      },
      error: (error) => {
        this.isSaving = false;
        console.error('Error saving settings:', error);
        this.toast_service.error('Error saving settings');
      },
    });
  }

  resetToDefaults() {
    if (
      confirm(
        '¿Estás seguro de restablecer todas las configuraciones a valores por defecto?',
      )
    ) {
      this.settings_service.resetToDefault().subscribe({
        next: () => this.loadSettings(),
        error: (error) => {
          console.error('Error resetting settings:', error);
          this.toast_service.error('Error resetting settings');
        },
      });
    }
  }

  openTemplates() {
    this.showTemplates = true;
    this.loadTemplates();
  }

  applyTemplate(template_name: string) {
    if (
      confirm(
        `¿Aplicar la plantilla "${template_name}"? Esto reemplazará toda la configuración actual.`,
      )
    ) {
      this.settings_service.applyTemplate(template_name).subscribe({
        next: (response) => {
          this.settings = response.data;
          this.showTemplates = false;
          this.toast_service.success('Plantilla aplicada correctamente');
        },
        error: (error) => {
          console.error('Error applying template:', error);
          this.toast_service.error('Error aplicando plantilla');
        },
      });
    }
  }

  ngOnDestroy() { }
}
