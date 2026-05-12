import { Component, OnInit, DestroyRef, effect, inject, input, output, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import {
  PosSettings,
  BusinessHours,
  ScaleSettings,
  ScaleDeviceConfig,
} from '../../../../../../../core/models/store-settings.interface';
import { PosScaleService } from '../../../../pos/services/pos-scale.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-pos-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, SettingToggleComponent],
  templateUrl: './pos-settings-form.component.html',
  styleUrls: ['./pos-settings-form.component.scss'],
})
export class PosSettingsForm implements OnInit {
  readonly settings = input.required<PosSettings>();
  readonly settingsLoaded = input<boolean>(false);
  readonly settingsChange = output<PosSettings>();

  private destroyRef = inject(DestroyRef);

  constructor(
    private scaleService: PosScaleService,
    private toastService: ToastService,
  ) {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(
          {
            ...current,
            business_hours: current.business_hours || this.getDefaultBusinessHours(),
          },
          { emitEvent: false },
        );
        this.syncDependentControlsState();
      }
    });
  }

  form: FormGroup = new FormGroup({
    allow_anonymous_sales: new FormControl<boolean | null>(null),
    anonymous_sales_as_default: new FormControl<boolean | null>(null),
    business_hours: new FormControl<Record<string, BusinessHours> | null>(null),
    enable_schedule_validation: new FormControl<boolean | null>(null),
    show_onscreen_keypad: new FormControl<boolean | null>(null),
    require_cash_drawer_open: new FormControl<boolean | null>(null),
    auto_print_receipt: new FormControl<boolean | null>(null),
    allow_price_edit: new FormControl<boolean | null>(null),
    allow_discount: new FormControl<boolean | null>(null),
    max_discount_percentage: new FormControl<number | null>(null),
    allow_refund_without_approval: new FormControl<boolean | null>(null),
    scale: new FormGroup({
      enabled: new FormControl<boolean | null>(null),
      allow_manual_weight_entry: new FormControl<boolean | null>(null),
      default_weight_unit: new FormControl<string | null>(null),
      device: new FormGroup({
        baud_rate: new FormControl<number | null>(null),
        data_bits: new FormControl<number | null>(null),
        stop_bits: new FormControl<number | null>(null),
        parity: new FormControl<string | null>(null),
        protocol: new FormControl<string | null>(null),
      }),
    }),
    cash_register: new FormGroup({
      enabled: new FormControl<boolean | null>(null),
      require_session_for_sales: new FormControl<boolean | null>(null),
      allow_multiple_sessions_per_user: new FormControl<boolean | null>(null),
      auto_create_default_register: new FormControl<boolean | null>(null),
      require_closing_count: new FormControl<boolean | null>(null),
      track_non_cash_payments: new FormControl<boolean | null>(null),
    }),
    customer_queue: new FormGroup({
      enabled: new FormControl<boolean | null>(null),
      queue_expiry_hours: new FormControl<number | null>(null),
      max_queue_size: new FormControl<number | null>(null),
      require_email: new FormControl<boolean | null>(null),
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
    return this.form.get(
      'scale.allow_manual_weight_entry',
    ) as FormControl<boolean>;
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
    return this.form.get(
      'cash_register.require_session_for_sales',
    ) as FormControl<boolean>;
  }

  get allowMultipleSessionsControl(): FormControl<boolean> {
    return this.form.get(
      'cash_register.allow_multiple_sessions_per_user',
    ) as FormControl<boolean>;
  }

  get autoCreateDefaultRegisterControl(): FormControl<boolean> {
    return this.form.get(
      'cash_register.auto_create_default_register',
    ) as FormControl<boolean>;
  }

  get requireClosingCountControl(): FormControl<boolean> {
    return this.form.get(
      'cash_register.require_closing_count',
    ) as FormControl<boolean>;
  }

  get trackNonCashPaymentsControl(): FormControl<boolean> {
    return this.form.get(
      'cash_register.track_non_cash_payments',
    ) as FormControl<boolean>;
  }

  // Customer Queue getters
  get customerQueueEnabledControl(): FormControl<boolean> {
    return this.form.get('customer_queue.enabled') as FormControl<boolean>;
  }

  get queueExpiryHoursControl(): FormControl<number> {
    return this.form.get(
      'customer_queue.queue_expiry_hours',
    ) as FormControl<number>;
  }

  get maxQueueSizeControl(): FormControl<number> {
    return this.form.get(
      'customer_queue.max_queue_size',
    ) as FormControl<number>;
  }

  get requireEmailControl(): FormControl<boolean> {
    return this.form.get(
      'customer_queue.require_email',
    ) as FormControl<boolean>;
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

  private wireDone = false;

  ngOnInit() {
    // Defer wiring until data is loaded so dependent controls don't react to
    // null bootstrap values.
    effect(() => {
      if (this.settingsLoaded() && !this.wireDone) {
        this.wireDone = true;
        this.wireDependentControls();
      }
    }, { injector: this.injector });
  }

  private injector = inject(Injector);

  private readonly dependentLinks = (): Array<[FormControl<boolean>, FormControl[]]> => [
    [this.allowAnonymousSalesControl, [this.anonymousSalesAsDefaultControl]],
    [this.scaleEnabledControl, [this.allowManualWeightEntryControl]],
    [
      this.cashRegisterEnabledControl,
      [
        this.requireSessionForSalesControl,
        this.requireClosingCountControl,
        this.trackNonCashPaymentsControl,
        this.allowMultipleSessionsControl,
        this.autoCreateDefaultRegisterControl,
      ],
    ],
    [this.customerQueueEnabledControl, [this.requireEmailControl]],
  ];

  private applyDependents(enabled: boolean | null, dependents: FormControl[]) {
    for (const dep of dependents) {
      if (enabled) dep.enable({ emitEvent: false });
      else dep.disable({ emitEvent: false });
    }
  }

  private syncDependentControlsState() {
    for (const [master, dependents] of this.dependentLinks()) {
      this.applyDependents(master.value, dependents);
    }
  }

  private wireDependentControls() {
    for (const [master, dependents] of this.dependentLinks()) {
      this.applyDependents(master.value, dependents);
      master.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((enabled) => this.applyDependents(enabled, dependents));
    }
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

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.getRawValue());
    }
  }

  onBusinessHoursChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.getRawValue());
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
