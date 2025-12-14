import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { AuthService } from '../../../core/services/auth.service';
import { finalize } from 'rxjs';
import { ButtonComponent } from '../button/button.component';

@Component({
    selector: 'app-settings-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, ModalComponent, ButtonComponent],
    template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="'Configuración de Usuario'"
      [subtitle]="'Administra tus preferencias de usuario (JSON)'"
      [size]="'lg'"
      (closed)="onClose()"
      (opened)="onOpen()"
    >
      <form [formGroup]="settingsForm" (ngSubmit)="onSubmit()" class="space-y-6">
        <!-- Config JSON -->
        <div>
          <h4 class="text-lg font-medium text-gray-900 mb-4">Configuración JSON</h4>
          <div class="grid grid-cols-1 gap-4">
             <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-gray-700">Config (JSON)</label>
                <textarea
                    formControlName="configJson"
                    class="w-full h-64 p-3 border border-gray-300 rounded-md font-mono text-sm focus:ring-blue-500 focus:border-blue-500"
                    [class.border-red-500]="getError('configJson')"
                    placeholder='{"theme": "dark", ...}'
                ></textarea>
                <div *ngIf="getError('configJson')" class="text-xs text-red-500 mt-1">
                    {{ getError('configJson') }}
                </div>
                <div class="text-xs text-gray-500 mt-1">
                    Edita el JSON de configuración directamente.
                </div>
             </div>
          </div>
        </div>

      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="secondary"
          (click)="isOpen = false"
          label="Cancelar"
        ></app-button>
        <app-button
          variant="primary"
          (click)="onSubmit()"
          [loading]="saving"
          [disabled]="settingsForm.invalid || settingsForm.pristine"
          label="Guardar Configuración"
        ></app-button>
      </div>
    </app-modal>
  `
})
export class SettingsModalComponent implements OnInit {
    @Input() isOpen = false;
    @Output() isOpenChange = new EventEmitter<boolean>();

    private fb = inject(FormBuilder);
    private authService = inject(AuthService);

    settingsForm: FormGroup;
    loading = false;
    saving = false;

    constructor() {
        this.settingsForm = this.fb.group({
            configJson: ['', [Validators.required, this.jsonValidator]]
        });
    }

    ngOnInit() { }

    onOpen() {
        this.loadSettings();
    }

    onClose() {
        this.isOpenChange.emit(false);
        this.settingsForm.reset();
    }

    loadSettings() {
        this.loading = true;
        this.authService.getSettings()
            .pipe(finalize(() => this.loading = false))
            .subscribe({
                next: (response) => {
                    const settings = response.data || response;
                    // Format JSON for display
                    const configFormatted = JSON.stringify(settings.config || {}, null, 2);

                    this.settingsForm.patchValue({
                        configJson: configFormatted
                    });
                },
                error: (err) => console.error('Error loading settings', err)
            });
    }

    onSubmit() {
        if (this.settingsForm.invalid) return;

        this.saving = true;
        const formValue = this.settingsForm.getRawValue();

        let configObj = {};
        try {
            configObj = JSON.parse(formValue.configJson);
        } catch (e) {
            console.error('Invalid JSON', e);
            this.saving = false;
            return;
        }

        const dto = {
            config: configObj
        };

        this.authService.updateSettings(dto)
            .pipe(finalize(() => this.saving = false))
            .subscribe({
                next: () => {
                    this.isOpen = false;
                    this.isOpenChange.emit(false);
                },
                error: (err) => console.error('Error saving settings', err)
            });
    }

    jsonValidator(control: any) {
        if (!control.value) return null;
        try {
            JSON.parse(control.value);
            return null;
        } catch (e) {
            return { invalidJson: true };
        }
    }

    getError(controlName: string): string {
        const control = this.settingsForm.get(controlName);
        if (control?.touched && control?.errors) {
            if (control.errors['required']) return 'Este campo es requerido';
            if (control.errors['invalidJson']) return 'Formato JSON inválido';
        }
        return '';
    }
}
