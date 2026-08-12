import {
  Component,
  computed,
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
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import { dataUrlToFile } from '../../../../../../../shared/utils/data-url.util';
import { LucideAngularModule } from 'lucide-angular';

/** Formato hexadecimal de 6 dígitos — el mismo que valida el FormGroup. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Paleta observable por la plantilla para pintar la vista previa. */
interface BrandPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
}

/** Metadatos de ayuda de cada color: qué gobierna y dónde se nota. */
interface BrandColorHelp {
  readonly key: 'primary_color' | 'secondary_color' | 'accent_color';
  readonly label: string;
  readonly hint: string;
  readonly tooltip: string;
}

@Component({
  selector: 'app-app-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    ImageSourceModalComponent,
    AlertBannerComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
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

  /** Panel de ayuda «¿dónde se ve cada recurso?» — arranca colapsado. */
  readonly assetsHelpOpen = signal(false);

  /**
   * Espejo en señal de los tres colores del formulario. Un `computed` NO puede
   * leer `form.value` (es una propiedad plana, no una señal: se evaluaría una
   * sola vez), así que la paleta se empuja explícitamente desde el effect de
   * carga y desde cada handler de cambio. Es lo que alimenta la vista previa.
   */
  readonly brandPalette = signal<BrandPalette>({
    primary: '#7ED7A5',
    secondary: '#2F6F4E',
    accent: '#FFFFFF',
  });

  /**
   * `onFieldChange()` sólo emite cuando el FormGroup es válido, así que un hex
   * mal escrito descarta el cambio EN SILENCIO. Este flag es lo que permite
   * decírselo al operador en vez de dejarlo creer que ya guardó.
   */
  readonly hasInvalidHex = computed(() => {
    const palette = this.brandPalette();
    return [palette.primary, palette.secondary, palette.accent].some(
      (value) => !HEX_COLOR.test(value ?? ''),
    );
  });

  /** Copy de ayuda por color. Ver ThemeService: cada uno alimenta un token. */
  readonly colorHelp: ReadonlyArray<BrandColorHelp> = [
    {
      key: 'primary_color',
      label: 'Primario',
      hint: 'Botones principales, enlaces y estados activos.',
      tooltip:
        'Es el color de acción de toda la app: el botón «Guardar», las pestañas activas y los enlaces. Alimenta el token --color-primary, así que un primario muy claro sobre fondo blanco deja los botones ilegibles. Ejemplo seguro: #2F6F4E.',
    },
    {
      key: 'secondary_color',
      label: 'Secundario',
      hint: 'Acciones de apoyo y acentos de encabezados.',
      tooltip:
        'Se usa en los elementos que acompañan a la acción principal: botones secundarios, chips y encabezados destacados. Conviene que contraste con el primario, no que se le parezca. Ejemplo: primario #2F6F4E con secundario #7ED7A5.',
    },
    {
      key: 'accent_color',
      label: 'Acento',
      hint: 'Detalles y realces puntuales sobre superficies.',
      tooltip:
        'Realces pequeños: bordes, insignias y fondos de énfasis. Al ser el color que suele ir DEBAJO de texto, un acento oscuro con texto oscuro se vuelve ilegible. Ejemplo: #FFFFFF.',
    },
  ];

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

  /** Resuelve el control de un color desde el metadato de ayuda. */
  colorControlFor(key: BrandColorHelp['key']): FormControl<string> {
    return this.form.get(key) as FormControl<string>;
  }

  /**
   * Empuja el valor de los tres controles de color a `brandPalette`. Se llama
   * después de cada escritura del formulario porque los FormControl no son
   * señales y la vista previa sí lo es.
   */
  private syncBrandPalette(): void {
    this.brandPalette.set({
      primary: this.primaryColorControl.value ?? '',
      secondary: this.secondaryColorControl.value ?? '',
      accent: this.accentColorControl.value ?? '',
    });
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
        // La paleta se lee del formulario ya parcheado, no de `currentSettings`,
        // para que la vista previa refleje exactamente lo que se va a guardar.
        this.syncBrandPalette();
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
    this.syncBrandPalette();
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
