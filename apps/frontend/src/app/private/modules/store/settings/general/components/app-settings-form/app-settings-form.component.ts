import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { AppSettings } from '../../../../../../../core/models/store-settings.interface';
import { IconComponent } from '../../../../../../../shared/components/index';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-app-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    LucideAngularModule,
  ],
  templateUrl: './app-settings-form.component.html',
  styleUrls: ['./app-settings-form.component.scss'],
})
export class AppSettingsForm implements OnInit, OnChanges, OnDestroy {
  @Input() settings!: AppSettings;
  @Output() settingsChange = new EventEmitter<AppSettings>();
  @Output() pendingLogoUpload = new EventEmitter<{ file: File; preview: string } | null>();
  @Output() pendingFaviconUpload = new EventEmitter<{ file: File; preview: string } | null>();

  logoPreview: string | null = null;
  faviconPreview: string | null = null;
  private logoBlobUrl: string | null = null;
  private faviconBlobUrl: string | null = null;
  private logoInputRef: HTMLInputElement | null = null;
  private faviconInputRef: HTMLInputElement | null = null;

  private toastService = inject(ToastService);


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
      // Preserve local blob preview if user already selected a file
      if (!this.logoBlobUrl) {
        this.logoPreview = this.settings.logo_url || null;
      }
      if (!this.faviconBlobUrl) {
        this.faviconPreview = this.settings.favicon_url || null;
      }
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

  // --- Logo file upload ---
  triggerLogoInput(): void {
    if (!this.logoInputRef) {
      this.logoInputRef = document.createElement('input');
      this.logoInputRef.type = 'file';
      this.logoInputRef.accept = 'image/*';
      this.logoInputRef.addEventListener('change', (e) => this.onLogoFileSelect(e));
    }
    this.logoInputRef.click();
  }

  onLogoFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      this.toastService.warning('Solo se permiten archivos de imagen');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.toastService.warning('El logo excede el tamaño máximo de 2MB');
      return;
    }

    if (this.logoBlobUrl) URL.revokeObjectURL(this.logoBlobUrl);
    this.logoBlobUrl = URL.createObjectURL(file);
    this.logoPreview = this.logoBlobUrl;
    this.pendingLogoUpload.emit({ file, preview: this.logoBlobUrl });
    this.onFieldChange();
    input.value = '';
  }

  removeLogo(): void {
    if (this.logoBlobUrl) {
      URL.revokeObjectURL(this.logoBlobUrl);
      this.logoBlobUrl = null;
    }
    this.logoPreview = null;
    this.logoUrlControl.setValue(null);
    this.pendingLogoUpload.emit(null);
    this.onFieldChange();
  }

  // --- Favicon file upload ---
  triggerFaviconInput(): void {
    if (!this.faviconInputRef) {
      this.faviconInputRef = document.createElement('input');
      this.faviconInputRef.type = 'file';
      this.faviconInputRef.accept = 'image/*';
      this.faviconInputRef.addEventListener('change', (e) => this.onFaviconFileSelect(e));
    }
    this.faviconInputRef.click();
  }

  onFaviconFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      this.toastService.warning('Solo se permiten archivos de imagen');
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      this.toastService.warning('El favicon excede el tamaño máximo de 1MB');
      return;
    }

    if (this.faviconBlobUrl) URL.revokeObjectURL(this.faviconBlobUrl);
    this.faviconBlobUrl = URL.createObjectURL(file);
    this.faviconPreview = this.faviconBlobUrl;
    this.pendingFaviconUpload.emit({ file, preview: this.faviconBlobUrl });
    this.onFieldChange();
    input.value = '';
  }

  removeFavicon(): void {
    if (this.faviconBlobUrl) {
      URL.revokeObjectURL(this.faviconBlobUrl);
      this.faviconBlobUrl = null;
    }
    this.faviconPreview = null;
    this.faviconUrlControl.setValue(null);
    this.pendingFaviconUpload.emit(null);
    this.onFieldChange();
  }

  ngOnDestroy(): void {
    if (this.logoBlobUrl) URL.revokeObjectURL(this.logoBlobUrl);
    if (this.faviconBlobUrl) URL.revokeObjectURL(this.faviconBlobUrl);
  }
}
