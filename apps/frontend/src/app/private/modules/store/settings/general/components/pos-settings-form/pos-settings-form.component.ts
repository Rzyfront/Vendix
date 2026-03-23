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
import { PosSettings, BusinessHours, ScaleSettings, ScaleDeviceConfig } from '../../../../../../../core/models/store-settings.interface';
import { PosScaleService } from '../../../../pos/services/pos-scale.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';


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

  constructor(
    private scaleService: PosScaleService,
    private toastService: ToastService,
  ) {}

  form: FormGroup = new FormGroup({
    allow_anonymous_sales: new FormControl(false),
    anonymous_sales_as_default: new FormControl(false),
    business_hours: new FormControl(this.getDefaultBusinessHours()),
    enable_schedule_validation: new FormControl(false),
    show_onscreen_keypad: new FormControl(true),
    require_cash_drawer_open: new FormControl(false),
    auto_print_receipt: new FormControl(true),
    allow_price_edit: new FormControl(true),
    allow_discount: new FormControl(true),
    max_discount_percentage: new FormControl(15),
    allow_refund_without_approval: new FormControl(false),
    scale: new FormGroup({
      enabled: new FormControl(false),
      allow_manual_weight_entry: new FormControl(true),
      default_weight_unit: new FormControl('kg'),
      device: new FormGroup({
        baud_rate: new FormControl(9600),
        data_bits: new FormControl(8),
        stop_bits: new FormControl(1),
        parity: new FormControl('none'),
        protocol: new FormControl('generic'),
      }),
    }),
    cash_register: new FormGroup({
      enabled: new FormControl(false),
      require_session_for_sales: new FormControl(false),
      allow_multiple_sessions_per_user: new FormControl(false),
      auto_create_default_register: new FormControl(true),
      require_closing_count: new FormControl(true),
      track_non_cash_payments: new FormControl(true),
    }),
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

  get showOnscreenKeypadControl(): FormControl<boolean> {
    return this.form.get('show_onscreen_keypad') as FormControl<boolean>;
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

  get enableScheduleValidationControl(): FormControl<boolean> {
    return this.form.get('enable_schedule_validation') as FormControl<boolean>;
  }

  get scaleEnabledControl(): FormControl<boolean> {
    return this.form.get('scale.enabled') as FormControl<boolean>;
  }

  get allowManualWeightEntryControl(): FormControl<boolean> {
    return this.form.get('scale.allow_manual_weight_entry') as FormControl<boolean>;
  }

  get defaultWeightUnitControl(): FormControl<string> {
    return this.form.get('scale.default_weight_unit') as FormControl<string>;
  }

  get baudRateControl(): FormControl<number> {
    return this.form.get('scale.device.baud_rate') as FormControl<number>;
  }

  get protocolControl(): FormControl<string> {
    return this.form.get('scale.device.protocol') as FormControl<string>;
  }

  // Cash Register getters
  get cashRegisterEnabledControl(): FormControl<boolean> {
    return this.form.get('cash_register.enabled') as FormControl<boolean>;
  }

  get requireSessionForSalesControl(): FormControl<boolean> {
    return this.form.get('cash_register.require_session_for_sales') as FormControl<boolean>;
  }

  get allowMultipleSessionsControl(): FormControl<boolean> {
    return this.form.get('cash_register.allow_multiple_sessions_per_user') as FormControl<boolean>;
  }

  get autoCreateDefaultRegisterControl(): FormControl<boolean> {
    return this.form.get('cash_register.auto_create_default_register') as FormControl<boolean>;
  }

  get requireClosingCountControl(): FormControl<boolean> {
    return this.form.get('cash_register.require_closing_count') as FormControl<boolean>;
  }

  get trackNonCashPaymentsControl(): FormControl<boolean> {
    return this.form.get('cash_register.track_non_cash_payments') as FormControl<boolean>;
  }

  get isWebSerialSupported(): boolean {
    return this.scaleService.isWebSerialSupported();
  }

  testingConnection = false;

  async testScaleConnection(): Promise<void> {
    this.testingConnection = true;
    const deviceGroup = this.form.get('scale.device') as FormGroup;
    this.scaleService.configure(deviceGroup.value);

    const connected = await this.scaleService.connect();
    this.testingConnection = false;

    if (connected) {
      this.toastService.success('Báscula conectada correctamente');
      setTimeout(() => this.scaleService.disconnect(), 3000);
    } else {
      this.toastService.warning('No se pudo conectar a la báscula');
    }
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
