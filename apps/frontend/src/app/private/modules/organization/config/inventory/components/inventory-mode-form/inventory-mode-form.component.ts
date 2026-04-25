import { Component, effect, input, output, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
} from '@angular/forms';
import { SelectorComponent, SelectorOption } from '../../../../../../../shared/components/selector/selector.component';
import {
  OrganizationInventorySettings,
} from '../../../../../../../core/models/organization.model';

@Component({
  selector: 'app-inventory-mode-form',
  standalone: true,
  imports: [ReactiveFormsModule, SelectorComponent],
  templateUrl: './inventory-mode-form.component.html',
  styleUrl: './inventory-mode-form.component.scss',
})
export class InventoryModeFormComponent {
  readonly settings = input.required<OrganizationInventorySettings>();
  readonly settingsChange = output<OrganizationInventorySettings>();
  readonly saving = input<boolean>(false);

  readonly selectedMode = signal<OrganizationInventorySettings['mode']>('organizational');

  form = new FormGroup({
    low_stock_alerts_scope: new FormControl<string>('store'),
    fallback_on_stockout: new FormControl<string>('reject'),
  });

  readonly alertScopeOptions: SelectorOption[] = [
    { value: 'location', label: 'Por ubicación' },
    { value: 'store', label: 'Por tienda' },
    { value: 'org', label: 'A nivel organización' },
  ];

  readonly fallbackOptions: SelectorOption[] = [
    { value: 'reject', label: 'Rechazar venta' },
    { value: 'ask_user', label: 'Preguntar al usuario' },
    { value: 'auto_next_available', label: 'Siguiente ubicación disponible' },
  ];

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.selectedMode.set(current.mode);
        this.form.patchValue(
          {
            low_stock_alerts_scope: current.low_stock_alerts_scope,
            fallback_on_stockout: current.fallback_on_stockout,
          },
          { emitEvent: false },
        );
      }
    });
  }

  get alertScopeControl(): FormControl<string> {
    return this.form.get('low_stock_alerts_scope') as FormControl<string>;
  }

  get fallbackControl(): FormControl<string> {
    return this.form.get('fallback_on_stockout') as FormControl<string>;
  }

  modeCardClasses(mode: OrganizationInventorySettings['mode']): string {
    const selected = this.selectedMode() === mode;
    return [
      'mode-card',
      selected ? 'mode-card-selected' : 'mode-card-unselected',
    ].join(' ');
  }

  selectMode(mode: OrganizationInventorySettings['mode']): void {
    if (this.saving()) return;
    this.selectedMode.set(mode);
    this.emitSettings();
  }

  onFieldChange(): void {
    this.emitSettings();
  }

  private emitSettings(): void {
    if (this.form.valid) {
      this.settingsChange.emit({
        mode: this.selectedMode(),
        low_stock_alerts_scope:
          this.form.value.low_stock_alerts_scope as OrganizationInventorySettings['low_stock_alerts_scope'],
        fallback_on_stockout:
          this.form.value.fallback_on_stockout as OrganizationInventorySettings['fallback_on_stockout'],
      });
    }
  }
}
