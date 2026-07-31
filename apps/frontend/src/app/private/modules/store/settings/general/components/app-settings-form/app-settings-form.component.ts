import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
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
export class AppSettingsForm {
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

  /**
   * Previews de marca. Eran campos planos: en zoneless el repintado se dispara
   * con señales, así que un campo mutado desde un handler o un effect deja la
   * plantilla dependiendo de que algo más marque sucio al componente. Ver el
   * effect del constructor para la razón por la que el preview se restauraba
   * solo (QUI-289).
   */
  readonly logoPreview = signal<string | null>(null);
  readonly faviconPreview = signal<string | null>(null);

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
    // El preview sigue SIEMPRE al valor del control, que es la única fuente de
    // verdad de este formulario. Antes había un guard `!this.logoBlobUrl` para
    // que el effect no pisara un preview local, pero ese campo quedó en null
    // permanente cuando el preview pasó de blob URL a data URL: elegir un logo
    // escribía el preview y, en el mismo tick, `onFieldChange()` actualizaba el
    // `settings` del padre, el effect volvía a correr y restauraba el valor
    // persistido (null) — el usuario veía el placeholder y creía que la imagen
    // no había cargado (QUI-289). Ahora `onLogoImages` escribe también el
    // control, así que este effect converge al mismo data URL en vez de pisarlo.
    effect(() => {
      const currentSettings = this.settings();
      if (currentSettings) {
        this.form.patchValue(currentSettings, { emitEvent: false });
        this.logoPreview.set(
          this.displayable(currentSettings.logo_url, untracked(this.logoPreview)),
        );
        this.faviconPreview.set(
          this.displayable(
            currentSettings.favicon_url,
            untracked(this.faviconPreview),
          ),
        );
      }
    });
  }

  /**
   * Un valor sólo sirve como `src` si el navegador puede resolverlo por sí
   * mismo: un data URL propio o una URL absoluta ya firmada. Al guardar, el
   * padre escribe la clave S3 cruda (`organizations/…/logo.webp`) en `settings`
   * porque es lo que el PATCH debe mandar; si esa clave llegara al `src`, el
   * navegador la resolvería contra el vhost y pediría
   * `https://<tienda>.vendix.com/organizations/…` — 404 y logo roto a la vista
   * hasta que el GET posterior devuelva la URL firmada. Mientras ese GET llega,
   * conservamos el preview vigente (QUI-289).
   *
   * `null` sí se respeta: es el borrado explícito y debe limpiar el preview.
   */
  private displayable(
    value: string | null | undefined,
    current: string | null,
  ): string | null {
    if (!value) return null;
    return /^(data:|https?:\/\/)/.test(value) ? value : current;
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

    // El data URL recortado es propio y persistente: úsalo como preview y como
    // valor del control, para que el effect de arriba converja a lo mismo en vez
    // de restaurar el logo persistido. Nunca llega al backend: el padre
    // reemplaza `app.logo_url` por la clave S3 del upload antes de guardar, y si
    // el upload falla no se manda ningún PATCH.
    this.logoPreview.set(dataUrl);
    this.logoUrlControl.setValue(dataUrl, { emitEvent: false });
    this.pendingLogoUpload.emit({ file, preview: dataUrl });
    this.onFieldChange();
  }

  removeLogo(): void {
    this.logoPreview.set(null);
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

    this.faviconPreview.set(dataUrl);
    this.faviconUrlControl.setValue(dataUrl, { emitEvent: false });
    this.pendingFaviconUpload.emit({ file, preview: dataUrl });
    this.onFieldChange();
  }

  removeFavicon(): void {
    this.faviconPreview.set(null);
    this.faviconUrlControl.setValue(null);
    this.pendingFaviconUpload.emit(null);
    this.onFieldChange();
  }
}
