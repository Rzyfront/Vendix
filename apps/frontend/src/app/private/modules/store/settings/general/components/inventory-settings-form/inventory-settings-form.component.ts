import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
  costing_method: 'cpp' | 'fifo';
}

import { IconComponent } from '../../../../../../../shared/components/index';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-inventory-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, SelectorComponent],
  templateUrl: './inventory-settings-form.component.html',
  styleUrls: ['./inventory-settings-form.component.scss'],
})
export class InventorySettingsForm {
  readonly settings = input.required<InventorySettings>();
  readonly settingsChange = output<InventorySettings>();

  form: FormGroup = new FormGroup({
    low_stock_threshold: new FormControl(10),
    out_of_stock_action: new FormControl('hide'),
    track_inventory: new FormControl(true),
    allow_negative_stock: new FormControl(false),
    costing_method: new FormControl('cpp'),
  });

  outOfStockActions: SelectorOption[] = [
    { value: 'hide', label: 'Ocultar producto' },
    { value: 'show', label: 'Mostrar como agotado' },
    { value: 'disable', label: 'Deshabilitar compras' },
    { value: 'allow_backorder', label: 'Permitir pedidos pendientes' },
  ];

  costingMethods: SelectorOption[] = [
    { value: 'cpp', label: 'CPP (Costo Promedio Ponderado)' },
    { value: 'fifo', label: 'FIFO (Primero en Entrar, Primero en Salir)' },
  ];

  // Typed getters for FormControls
  get lowStockThresholdControl(): FormControl<number> {
    return this.form.get('low_stock_threshold') as FormControl<number>;
  }

  get outOfStockActionControl(): FormControl<string> {
    return this.form.get('out_of_stock_action') as FormControl<string>;
  }

  get trackInventoryControl(): FormControl<boolean> {
    return this.form.get('track_inventory') as FormControl<boolean>;
  }

  get allowNegativeStockControl(): FormControl<boolean> {
    return this.form.get('allow_negative_stock') as FormControl<boolean>;
  }

  get costingMethodControl(): FormControl<string> {
    return this.form.get('costing_method') as FormControl<string>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });
  }

  onSubmit() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  onFieldChange() {
    // Auto-save on any field change
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }
}
