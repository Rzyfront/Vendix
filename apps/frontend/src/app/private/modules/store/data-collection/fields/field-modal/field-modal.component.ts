import { Component, ChangeDetectionStrategy, input, output, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MetadataField } from '../../interfaces/metadata-field.interface';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';

@Component({
  selector: 'app-field-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, InputComponent, SelectorComponent, TextareaComponent, ButtonComponent, SettingToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="true"
      (isOpenChange)="onOpenChange($event)"
      [title]="field() ? 'Editar Campo' : 'Nuevo Campo'"
      size="md"
    >
      <div class="space-y-4">
        <app-input
          label="Label"
          [(ngModel)]="formData.label"
          (inputChange)="autoGenerateKey()"
          [required]="true"
        />

        <app-input
          label="Key"
          [(ngModel)]="formData.field_key"
          [disabled]="!!field()"
        />

        <div class="grid grid-cols-2 gap-4">
          <app-selector
            label="Tipo de Entidad"
            [(ngModel)]="formData.entity_type"
            [options]="entityTypeOptions"
            [required]="true"
          />

          <app-selector
            label="Tipo de Campo"
            [(ngModel)]="formData.field_type"
            [options]="fieldTypeOptions"
            [required]="true"
          />
        </div>

        <app-textarea
          label="Descripción"
          [(ngModel)]="formData.description"
          [rows]="2"
        />

        <div class="grid grid-cols-2 gap-4">
          <app-selector
            label="Modo de Display"
            [(ngModel)]="formData.display_mode"
            [options]="displayModeOptions"
          />

          <div class="flex items-end pb-1">
            <app-setting-toggle
              label="Obligatorio"
              [(ngModel)]="formData.is_required"
            />
          </div>
        </div>

        @if (formData.field_type === 'select') {
          <app-textarea
            label="Opciones (una por línea)"
            [(ngModel)]="optionsText"
            [rows]="4"
          />
        }
      </div>

      <div slot="footer" class="flex items-center justify-end gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onSave()">{{ field() ? 'Guardar' : 'Crear' }}</app-button>
      </div>
    </app-modal>
  `,
})
export class FieldModalComponent implements OnInit {
  field = input<MetadataField | null>(null);
  save = output<any>();
  close = output<void>();

  fieldTypes = ['text', 'number', 'date', 'select', 'checkbox', 'textarea', 'file', 'email', 'phone', 'url'];

  entityTypeOptions = [
    { value: 'customer', label: 'Cliente' },
    { value: 'booking', label: 'Reserva' },
    { value: 'order', label: 'Orden' },
  ];

  fieldTypeOptions = this.fieldTypes.map(t => ({ value: t, label: t }));

  displayModeOptions = [
    { value: 'detail', label: 'Detalle' },
    { value: 'summary', label: 'Resumen' },
  ];

  formData: any = {
    label: '',
    field_key: '',
    entity_type: 'customer',
    field_type: 'text',
    description: '',
    display_mode: 'detail',
    is_required: false,
  };

  optionsText = '';

  ngOnInit() {
    const f = this.field();
    if (f) {
      this.formData = {
        label: f.label,
        field_key: f.field_key,
        entity_type: f.entity_type,
        field_type: f.field_type,
        description: f.description || '',
        display_mode: f.display_mode,
        is_required: f.is_required,
      };
      if (f.options && Array.isArray(f.options)) {
        this.optionsText = f.options.join('\n');
      }
    }
  }

  onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      this.close.emit();
    }
  }

  autoGenerateKey() {
    if (!this.field()) {
      this.formData.field_key = this.formData.label
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 100);
    }
  }

  onSave() {
    const data = { ...this.formData };
    if (data.field_type === 'select' && this.optionsText) {
      data.options = this.optionsText.split('\n').map((o: string) => o.trim()).filter(Boolean);
    }
    this.save.emit(data);
  }
}
