import {
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

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
import { ImageSourceModalComponent } from '../../../../../../../shared/components/image-source-modal/image-source-modal.component';
import { dataUrlToFile } from '../../../../../../../shared/utils/data-url.util';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-app-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    ImageSourceModalComponent,
    LucideAngularModule,
  ],
  templateUrl: './app-settings-form.component.html',
  styleUrls: ['./app-settings-form.component.scss'],
})
export class AppSettingsForm implements OnDestroy {
  readonly settings = input.required<AppSettings>();
  readonly settingsChange = output<AppSettings>();
  readonly pendingLogoUpload = output<{
    file: File;
    preview: string;
  } | null>();
  readonly pendingFaviconUpload = output<{
    file: File;
    preview: string;
  } | null>();

  logoPreview: string | null = null;
  faviconPreview: string | null = null;
  private logoBlobUrl: string | null = null;
  private faviconBlobUrl: string | null = null;

  readonly logoModalOpen = signal(false);
  readonly faviconModalOpen = signal(false);

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

  constructor() {
    effect(() => {
      const currentSettings = this.settings();
      if (currentSettings) {
        this.form.patchValue(currentSettings, { emitEvent: false });
        if (!this.logoBlobUrl) {
          this.logoPreview = currentSettings.logo_url || null;
        }
        if (!this.faviconBlobUrl) {
          this.faviconPreview = currentSettings.favicon_url || null;
        }
      }
    });
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

  // --- Logo upload (via app-image-source-modal) ---
  openLogoModal(): void {
    this.logoModalOpen.set(true);
  }

  onLogoImages(dataUrls: string[]): void {
    const dataUrl = dataUrls[0];
    if (!dataUrl) return;

    const file = dataUrlToFile(dataUrl, `logo-${Date.now()}.jpg`);
    if (file.size > 2 * 1024 * 1024) {
      this.toastService.warning('El logo excede el tamaño máximo de 2MB');
      return;
    }

    if (this.logoBlobUrl) {
      URL.revokeObjectURL(this.logoBlobUrl);
      this.logoBlobUrl = null;
    }
    // El data URL recortado es propio y persistente: úsalo como preview.
    this.logoPreview = dataUrl;
    this.pendingLogoUpload.emit({ file, preview: dataUrl });
    this.onFieldChange();
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

  // --- Favicon upload (via app-image-source-modal) ---
  openFaviconModal(): void {
    this.faviconModalOpen.set(true);
  }

  onFaviconImages(dataUrls: string[]): void {
    const dataUrl = dataUrls[0];
    if (!dataUrl) return;

    const file = dataUrlToFile(dataUrl, `favicon-${Date.now()}.jpg`);
    if (file.size > 1 * 1024 * 1024) {
      this.toastService.warning('El favicon excede el tamaño máximo de 1MB');
      return;
    }

    if (this.faviconBlobUrl) {
      URL.revokeObjectURL(this.faviconBlobUrl);
      this.faviconBlobUrl = null;
    }
    this.faviconPreview = dataUrl;
    this.pendingFaviconUpload.emit({ file, preview: dataUrl });
    this.onFieldChange();
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
