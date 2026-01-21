import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreSettingsService } from './services/store-settings.service';
import { StoreSettings } from '../../../../../core/models/store-settings.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-general-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './general-settings.component.html',
  styleUrls: ['./general-settings.component.scss'],
})
export class GeneralSettingsComponent implements OnInit, OnDestroy {
  private settings_service = inject(StoreSettingsService);
  private toast_service = inject(ToastService);

  settings: StoreSettings = {} as StoreSettings;
  isLoading = true;
  isSaving = false;
  hasUnsavedChanges = false;
  lastSaved: Date | null = null;

  currentTab = 0;

  tabs = [
    { label: 'General', value: 0 },
    { label: 'Inventario', value: 1 },
    { label: 'Checkout', value: 2 },
    { label: 'Envíos', value: 3 },
    { label: 'Notificaciones', value: 4 },
    { label: 'POS', value: 5 },
    { label: 'Recibos', value: 6 },
  ];

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

  onSectionChange(section: keyof StoreSettings, new_settings: any) {
    this.settings = {
      ...this.settings,
      [section]: new_settings,
    };
    this.hasUnsavedChanges = true;
    this.lastSaved = null;
    this.settings_service.saveSettings({ [section]: new_settings });
    this.toast_service.info('Guardando cambios...');
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

  ngOnDestroy() {}
}
