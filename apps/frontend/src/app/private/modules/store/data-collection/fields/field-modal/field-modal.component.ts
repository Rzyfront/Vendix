import { Component, ChangeDetectionStrategy, input, output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { MetadataField } from '../../interfaces/metadata-field.interface';

@Component({
  selector: 'app-field-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.5)"
         (click)="close.emit()">
      <div class="w-full max-w-lg rounded-xl shadow-xl" style="background: var(--color-surface)"
           (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4" style="border-bottom: 1px solid var(--color-border)">
          <h3 class="font-bold text-base" style="color: var(--color-text)">
            {{ field() ? 'Editar Campo' : 'Nuevo Campo' }}
          </h3>
          <button class="p-1 rounded-lg" style="color: var(--color-text-muted)" (click)="close.emit()">
            <app-icon name="x" [size]="18"></app-icon>
          </button>
        </div>

        <!-- Body -->
        <div class="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Label *</label>
            <input type="text" class="w-full px-3 py-2 border rounded-lg text-sm"
                   style="border-color: var(--color-border); background: var(--color-surface)"
                   [(ngModel)]="formData.label" (ngModelChange)="autoGenerateKey()" />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Key *</label>
            <input type="text" class="w-full px-3 py-2 border rounded-lg text-sm"
                   style="border-color: var(--color-border); background: var(--color-surface)"
                   [(ngModel)]="formData.field_key" [disabled]="!!field()" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Tipo de Entidad *</label>
              <select class="w-full px-3 py-2 border rounded-lg text-sm"
                      style="border-color: var(--color-border); background: var(--color-surface)"
                      [(ngModel)]="formData.entity_type">
                <option value="customer">Cliente</option>
                <option value="booking">Reserva</option>
                <option value="order">Orden</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Tipo de Campo *</label>
              <select class="w-full px-3 py-2 border rounded-lg text-sm"
                      style="border-color: var(--color-border); background: var(--color-surface)"
                      [(ngModel)]="formData.field_type">
                @for (type of fieldTypes; track type) {
                  <option [value]="type">{{ type }}</option>
                }
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Descripcion</label>
            <textarea class="w-full px-3 py-2 border rounded-lg text-sm resize-none" rows="2"
                      style="border-color: var(--color-border); background: var(--color-surface)"
                      [(ngModel)]="formData.description"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Modo de Display</label>
              <select class="w-full px-3 py-2 border rounded-lg text-sm"
                      style="border-color: var(--color-border); background: var(--color-surface)"
                      [(ngModel)]="formData.display_mode">
                <option value="detail">Detalle</option>
                <option value="summary">Resumen</option>
              </select>
            </div>
            <div class="flex items-end pb-1">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="w-4 h-4 rounded" [(ngModel)]="formData.is_required" />
                <span class="text-sm" style="color: var(--color-text)">Obligatorio</span>
              </label>
            </div>
          </div>

          @if (formData.field_type === 'select') {
            <div>
              <label class="block text-sm font-medium mb-1" style="color: var(--color-text)">Opciones (una por linea)</label>
              <textarea class="w-full px-3 py-2 border rounded-lg text-sm resize-none" rows="4"
                        style="border-color: var(--color-border); background: var(--color-surface)"
                        [(ngModel)]="optionsText"></textarea>
            </div>
          }
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-6 py-4" style="border-top: 1px solid var(--color-border)">
          <button class="px-4 py-2 rounded-lg text-sm font-medium"
                  style="color: var(--color-text); border: 1px solid var(--color-border)"
                  (click)="close.emit()">
            Cancelar
          </button>
          <button class="px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style="background: var(--color-primary)"
                  (click)="onSave()">
            {{ field() ? 'Guardar' : 'Crear' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class FieldModalComponent implements OnInit {
  field = input<MetadataField | null>(null);
  save = output<any>();
  close = output<void>();

  fieldTypes = ['text', 'number', 'date', 'select', 'checkbox', 'textarea', 'file', 'email', 'phone', 'url'];

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
