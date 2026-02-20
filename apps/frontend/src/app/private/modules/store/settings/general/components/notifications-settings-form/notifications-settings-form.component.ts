import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';

export interface NotificationsSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  low_stock_alerts: boolean;
  new_order_alerts: boolean;
  low_stock_alerts_email?: string | null;
  new_order_alerts_email?: string | null;
  low_stock_alerts_phone?: string | null;
  new_order_alerts_phone?: string | null;
}


@Component({
  selector: 'app-notifications-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, SettingToggleComponent],
  templateUrl: './notifications-settings-form.component.html',
  styleUrls: ['./notifications-settings-form.component.scss'],
})
export class NotificationsSettingsForm implements OnInit, OnChanges {
  @Input() settings!: NotificationsSettings;
  @Output() settingsChange = new EventEmitter<NotificationsSettings>();

  form: FormGroup = new FormGroup({
    email_enabled: new FormControl(true),
    sms_enabled: new FormControl(false),
    low_stock_alerts: new FormControl(true),
    new_order_alerts: new FormControl(true),
    low_stock_alerts_email: new FormControl(null),
    new_order_alerts_email: new FormControl(null),
    low_stock_alerts_phone: new FormControl(null, [Validators.pattern(/^[\d+#*\s()-]*$/)]),
    new_order_alerts_phone: new FormControl(null, [Validators.pattern(/^[\d+#*\s()-]*$/)]),
  });

  // Typed getters for FormControls
  get emailEnabledControl(): FormControl<boolean> {
    return this.form.get('email_enabled') as FormControl<boolean>;
  }

  get smsEnabledControl(): FormControl<boolean> {
    return this.form.get('sms_enabled') as FormControl<boolean>;
  }

  get lowStockAlertsControl(): FormControl<boolean> {
    return this.form.get('low_stock_alerts') as FormControl<boolean>;
  }

  get newOrderAlertsControl(): FormControl<boolean> {
    return this.form.get('new_order_alerts') as FormControl<boolean>;
  }

  get lowStockAlertsEmailControl(): FormControl<string | null> {
    return this.form.get('low_stock_alerts_email') as FormControl<
      string | null
    >;
  }

  get newOrderAlertsEmailControl(): FormControl<string | null> {
    return this.form.get('new_order_alerts_email') as FormControl<
      string | null
    >;
  }

  get lowStockAlertsPhoneControl(): FormControl<string | null> {
    return this.form.get('low_stock_alerts_phone') as FormControl<
      string | null
    >;
  }

  get newOrderAlertsPhoneControl(): FormControl<string | null> {
    return this.form.get('new_order_alerts_phone') as FormControl<
      string | null
    >;
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

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  get isEmailEnabled(): boolean {
    return this.form.get('email_enabled')?.value ?? false;
  }

  get isSmsEnabled(): boolean {
    return this.form.get('sms_enabled')?.value ?? false;
  }
}
