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
  imports: [
    CommonModule, LucideAngularModule,
    IconComponent,
    ButtonComponent,
    GeneralSettingsForm,
    InventorySettingsForm,
    NotificationsSettingsForm,
    PosSettingsForm,
    ReceiptsSettingsForm,
    AppSettingsForm,
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
    // Only update local state - don't save automatically
    this.settings = {
      ...this.settings,
      [section]: new_settings,
    };
    this.hasUnsavedChanges = true;
    this.lastSaved = null;
    this.saveError = null;
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
