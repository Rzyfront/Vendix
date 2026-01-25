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
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';

export interface BusinessHours {
  open: string;
  close: string;
}

export interface PosSettings {
  allow_anonymous_sales: boolean;
  anonymous_sales_as_default: boolean;
  business_hours: Record<string, BusinessHours>;
  offline_mode_enabled: boolean;
  require_cash_drawer_open: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  allow_discount: boolean;
  max_discount_percentage: number;
  allow_refund_without_approval: boolean;
}


@Component({
  selector: 'app-pos-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SettingToggleComponent],
  templateUrl: './pos-settings-form.component.html',
  styleUrls: ['./pos-settings-form.component.scss'],
})
export class PosSettingsForm implements OnInit, OnChanges {
  @Input() settings!: PosSettings;
  @Output() settingsChange = new EventEmitter<PosSettings>();

  form: FormGroup = new FormGroup({
    allow_anonymous_sales: new FormControl(false),
    anonymous_sales_as_default: new FormControl(false),
    business_hours: new FormControl(this.getDefaultBusinessHours()),
    offline_mode_enabled: new FormControl(false),
    require_cash_drawer_open: new FormControl(false),
    auto_print_receipt: new FormControl(true),
    allow_price_edit: new FormControl(true),
    allow_discount: new FormControl(true),
    max_discount_percentage: new FormControl(15),
    allow_refund_without_approval: new FormControl(false),
  });

  daysOfWeek = [
    { key: 'monday', label: 'Lunes' },
    { key: 'tuesday', label: 'Martes' },
    { key: 'wednesday', label: 'Miércoles' },
    { key: 'thursday', label: 'Jueves' },
    { key: 'friday', label: 'Viernes' },
    { key: 'saturday', label: 'Sábado' },
    { key: 'sunday', label: 'Domingo' },
  ];

  // Typed getters for FormControls
  get allowAnonymousSalesControl(): FormControl<boolean> {
    return this.form.get('allow_anonymous_sales') as FormControl<boolean>;
  }

  get anonymousSalesAsDefaultControl(): FormControl<boolean> {
    return this.form.get('anonymous_sales_as_default') as FormControl<boolean>;
  }

  get offlineModeEnabledControl(): FormControl<boolean> {
    return this.form.get('offline_mode_enabled') as FormControl<boolean>;
  }

  get requireCashDrawerOpenControl(): FormControl<boolean> {
    return this.form.get('require_cash_drawer_open') as FormControl<boolean>;
  }

  get autoPrintReceiptControl(): FormControl<boolean> {
    return this.form.get('auto_print_receipt') as FormControl<boolean>;
  }

  get allowPriceEditControl(): FormControl<boolean> {
    return this.form.get('allow_price_edit') as FormControl<boolean>;
  }

  get allowDiscountControl(): FormControl<boolean> {
    return this.form.get('allow_discount') as FormControl<boolean>;
  }

  get maxDiscountPercentageControl(): FormControl<number> {
    return this.form.get('max_discount_percentage') as FormControl<number>;
  }

  get allowRefundWithoutApprovalControl(): FormControl<boolean> {
    return this.form.get(
      'allow_refund_without_approval',
    ) as FormControl<boolean>;
  }

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  getDefaultBusinessHours(): Record<string, BusinessHours> {
    return {
      monday: { open: '09:00', close: '19:00' },
      tuesday: { open: '09:00', close: '19:00' },
      wednesday: { open: '09:00', close: '19:00' },
      thursday: { open: '09:00', close: '19:00' },
      friday: { open: '09:00', close: '19:00' },
      saturday: { open: '09:00', close: '14:00' },
      sunday: { open: 'closed', close: 'closed' },
    };
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue({
        ...this.settings,
        business_hours:
          this.settings.business_hours || this.getDefaultBusinessHours(),
      });
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  onBusinessHoursChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  isDayClosed(day: string): boolean {
    const hours = this.form.get('business_hours')?.value;
    return hours?.[day]?.open === 'closed';
  }

  toggleDayStatus(day: string) {
    const hours = this.form.get('business_hours')?.value;
    if (hours?.[day]?.open === 'closed') {
      hours[day] = { open: '09:00', close: '19:00' };
    } else {
      hours[day] = { open: 'closed', close: 'closed' };
    }
    this.form.get('business_hours')?.setValue(hours);
    this.onBusinessHoursChange();
  }

  onTimeChange(day: string, field: 'open' | 'close', value: string) {
    const hours = this.form.get('business_hours')?.value;
    if (hours?.[day]) {
      hours[day][field] = value;
      this.form.get('business_hours')?.setValue(hours);
      this.onBusinessHoursChange();
    }
  }
}
