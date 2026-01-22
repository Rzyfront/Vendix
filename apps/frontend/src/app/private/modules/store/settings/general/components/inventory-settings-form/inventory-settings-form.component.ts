import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';

export interface InventorySettings {
  low_stock_threshold: number;
  out_of_stock_action: 'hide' | 'show' | 'disable' | 'allow_backorder';
  track_inventory: boolean;
  allow_negative_stock: boolean;
}

@Component({
  selector: 'app-inventory-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, ToggleComponent],
  templateUrl: './inventory-settings-form.component.html',
  styleUrls: ['./inventory-settings-form.component.scss'],
})
export class InventorySettingsForm implements OnInit, OnChanges {
  @Input() settings!: InventorySettings;
  @Output() settingsChange = new EventEmitter<InventorySettings>();

  form: FormGroup = new FormGroup({
    low_stock_threshold: new FormControl(10),
    out_of_stock_action: new FormControl('hide'),
    track_inventory: new FormControl(true),
    allow_negative_stock: new FormControl(false),
  });

  outOfStockActions = [
    { value: 'hide', label: 'Ocultar producto' },
    { value: 'show', label: 'Mostrar como agotado' },
    { value: 'disable', label: 'Deshabilitar compras' },
    { value: 'allow_backorder', label: 'Permitir pedidos pendientes' },
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

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue(this.settings);
    }
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
