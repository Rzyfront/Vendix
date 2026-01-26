import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { AppSettings } from '../../../../../../../core/models/store-settings.interface';
import { IconComponent } from '../../../../../../../shared/components/index';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-app-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    LucideAngularModule,
  ],
  templateUrl: './app-settings-form.component.html',
  styleUrls: ['./app-settings-form.component.scss'],
})
export class AppSettingsForm implements OnInit, OnChanges {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<AppSettings>();

  form: FormGroup = new FormGroup({
    name: new FormControl('Vendix', [
      Validators.required,
      Validators.minLength(1),
      Validators.maxLength(100),
    ]),
    primary_color: new FormControl('#7ED7A5', [
      Validators.required,
      Validators.pattern(/^#[0-9A-Fa-f]{6}$/),
    ]),
    secondary_color: new FormControl('#2F6F4E', [
      Validators.required,
      Validators.pattern(/^#[0-9A-Fa-f]{6}$/),
    ]),
    accent_color: new FormControl('#FFFFFF', [
      Validators.required,
      Validators.pattern(/^#[0-9A-Fa-f]{6}$/),
    ]),
    logo_url: new FormControl(null),
    favicon_url: new FormControl(null),
  });

  // Typed getters para FormControls
  get nameControl(): FormControl<string> {
    return this.form.get('name') as FormControl<string>;
  }

  get primaryColorControl(): FormControl<string> {
    return this.form.get('primary_color') as FormControl<string>;
  }

  get secondaryColorControl(): FormControl<string> {
    return this.form.get('secondary_color') as FormControl<string>;
  }

  get accentColorControl(): FormControl<string> {
    return this.form.get('accent_color') as FormControl<string>;
  }

  get logoUrlControl(): FormControl<string | null> {
    return this.form.get('logo_url') as FormControl<string | null>;
  }

  get faviconUrlControl(): FormControl<string | null> {
    return this.form.get('favicon_url') as FormControl<string | null>;
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

  onColorPickerChange(
    field: 'primary_color' | 'secondary_color' | 'accent_color',
    event: Event,
  ) {
    const input = event.target as HTMLInputElement;
    this.form.get(field)?.setValue(input.value);
    this.onFieldChange();
  }
}
