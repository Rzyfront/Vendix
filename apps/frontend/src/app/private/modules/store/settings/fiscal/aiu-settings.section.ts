import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { SettingToggleComponent } from '../../../../../shared/components/setting-toggle/setting-toggle.component';
import { TextareaComponent } from '../../../../../shared/components/textarea/textarea.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { SettingsSectionComponent } from '../general/components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../general/services/general-settings.store';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  AIU_SETTINGS_DEFAULTS,
  AiuRegime,
  AiuSettings,
} from '../../../../../core/models/store-settings.interface';
import {
  buildAiuNote,
  DIAN_AIU_CONTRACT_OBJECT_MAX_LENGTH,
  DIAN_AIU_NOTE_MAX_LENGTH,
  DIAN_AIU_NOTE_MIN_LENGTH,
  DIAN_AIU_NOTE_PREFIX,
} from './aiu-note.constants';

/**
 * Una opción de régimen, con lo que de verdad hace falta para elegir.
 *
 * No es la cita legal lo que decide: es QUÉ actividades cubre y SOBRE QUÉ se
 * calcula el IVA. La cita va igual porque es lo que el contador va a pedir.
 */
interface RegimeOption {
  readonly value: AiuRegime;
  readonly label: string;
  readonly legal: string;
  readonly base: string;
  readonly scope: string;
  readonly isDefault?: boolean;
}

/**
 * Sección AIU — pestaña «Régimen AIU» dentro de la página fiscal.
 *
 * ## Por qué esta sección existe
 *
 * Los cuatro parámetros AIU ya los leía el emisor, pero sólo se podían escribir
 * por seed o por SQL. Una tienda de construcción quedaba emitiendo con el
 * régimen de aseo y vigilancia sin forma de corregirlo desde el producto.
 *
 * ## Por qué el guardado es propio y no el del shell
 *
 * El botón «Guardar Cambios» de la cabecera manda TODAS las secciones del
 * borrador de golpe (`GeneralSettingsStore.saveAllSettings`). Acá se manda sólo
 * `{ invoicing: { aiu: <lo que cambió> } }`: el backend mezcla esa sección POR
 * CLAVE, así que reenviar los cuatro campos cada vez sería reescribir con
 * valores viejos lo que otra pantalla —o el propio wizard fiscal— acabara de
 * cambiar.
 */
@Component({
  selector: 'app-aiu-settings-section',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SettingToggleComponent,
    TextareaComponent,
    SettingsSectionComponent,
  ],
  template: `
    <app-settings-section
        anchorId="section-aiu-regime"
        icon="scale"
        iconTone="purple"
        title="Régimen de base gravable"
        hint="Lo decide el objeto del contrato, no la preferencia del negocio. Si no estás seguro, confírmalo con tu contador ANTES de emitir.">
        <div
          class="regime-options"
          role="radiogroup"
          aria-label="Régimen de base gravable">
          @for (option of regimeOptions; track option.value) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="regime() === option.value"
              [disabled]="saving()"
              (click)="onRegimeChange(option.value)"
              class="regime-card"
              [class.regime-card--active]="regime() === option.value">
              <app-icon
                [name]="regime() === option.value ? 'check-circle' : 'circle'"
                [size]="18"
                [class]="
                  regime() === option.value
                    ? 'regime-card__mark regime-card__mark--on'
                    : 'regime-card__mark'
                " />
              <span class="regime-card__body">
                <span class="regime-card__title">
                  {{ option.label }}
                  @if (option.isDefault) {
                    <span class="regime-card__badge">Predeterminado</span>
                  }
                </span>
                <span class="regime-card__legal">{{ option.legal }}</span>
                <span class="regime-card__base">
                  Base gravable: <strong>{{ option.base }}</strong>
                </span>
                <span class="regime-card__scope">{{ option.scope }}</span>
              </span>
            </button>
          }
        </div>

        <!-- El aviso va junto a la decisión, no al pie de la pantalla: es la
             única señal que el usuario va a recibir, porque el error no produce
             ninguna otra. -->
        <div class="notice notice--danger">
          <app-icon name="alert-triangle" [size]="16" class="notice__icon" />
          <div class="notice__body">
            <p class="notice__title">Equivocarse aquí no produce ningún error.</p>
            <p>
              La DIAN acepta el documento igual y la factura queda declarando
              menos IVA del debido. Nadie avisa: aparece en una revisión, y para
              entonces ya corren sanción e intereses. Cambiar el régimen no
              corrige las facturas ya emitidas.
            </p>
          </div>
        </div>
      </app-settings-section>

      <app-settings-section
        anchorId="section-aiu-contract"
        icon="file-text"
        iconTone="blue"
        title="Objeto del contrato"
        hint="Va dentro de la factura, en la línea de Administración. Es obligatorio: sin él la DIAN rechaza el documento.">
        <p class="field-help">
          Vendix escribe una nota obligatoria en la línea de Administración. La
          nota empieza SIEMPRE por este texto, que no se puede cambiar, y a
          continuación va lo que describas:
        </p>
        <p class="note-prefix">{{ notePrefix }}</p>

        <app-textarea
          label="Describe qué se contrató"
          placeholder="servicio de aseo y cafetería para las sedes de Bogotá"
          [rows]="4"
          [error]="contractObjectError()"
          [ngModel]="contractObject()"
          (ngModelChange)="contractObject.set($event)" />

        <!-- El contador mide la NOTA COMPLETA, no lo que el usuario escribe: la
             regla CAV03 cuenta el prefijo, y un contador que lo omitiera diría
             que cumple cuando no cumple. -->
        <div class="counter" [class.counter--bad]="noteLengthInvalid()">
          <span class="counter__value">
            {{ noteLength() }} / {{ noteMaxLength }}
          </span>
          <span class="counter__hint">
            caracteres de la nota completa. El prefijo obligatorio ya ocupa
            {{ notePrefixLength }} y este contador lo incluye; el mínimo son
            {{ noteMinLength }}.
          </span>
        </div>

        @if (noteTooShort()) {
          <div class="notice notice--warning">
            <app-icon name="alert-triangle" [size]="16" class="notice__icon" />
            <div class="notice__body">
              <p class="notice__title">La nota todavía no cumple.</p>
              <p>
                Sin objeto de contrato la nota queda vacía y no llega al mínimo
                de {{ noteMinLength }} caracteres: cualquier factura AIU se
                rechazará al emitirse hasta que describas el contrato.
              </p>
            </div>
          </div>
        }

        <p class="preview-label">Así queda dentro de la factura</p>
        <p class="preview" [class.preview--empty]="noteTooShort()">
          {{ notePreview() }}
        </p>
      </app-settings-section>

      <app-settings-section
        anchorId="section-aiu-minimum"
        icon="shield-alert"
        iconTone="orange"
        title="Piso legal de la base gravable"
        hint="El artículo 462-1 fija un mínimo: la base no puede quedar por debajo de un porcentaje del valor del contrato.">
        @if (!minimumBaseApplies()) {
          <div class="notice notice--info">
            <app-icon name="info" [size]="16" class="notice__icon" />
            <div class="notice__body">
              <p class="notice__title">No aplica al régimen seleccionado.</p>
              <p>
                El Decreto 1372/1992 no fija piso sobre la utilidad. Estos dos
                ajustes quedan inactivos y no se guardarán mientras ese sea el
                régimen elegido.
              </p>
            </div>
          </div>
        }

        <app-setting-toggle
          label="Aplicar el piso legal al emitir"
          [description]="toggleDescription()"
          [disabled]="!minimumBaseApplies() || saving()"
          [ngModel]="enforceMinimumBase()"
          (ngModelChange)="enforceMinimumBase.set($event)" />

        <div class="percent-field">
          <app-input
            label="Porcentaje del piso legal"
            type="number"
            min="0"
            max="100"
            step="1"
            helperText="Parámetro legal, no comercial: hoy la norma dice 10 %. Cámbialo sólo si la ley cambia."
            [error]="percentError()"
            [disabled]="!minimumBaseApplies() || saving()"
            [ngModel]="minimumBasePercentInput()"
            (ngModelChange)="minimumBasePercentInput.set($event)" />
        </div>

        <div class="notice notice--info">
          <app-icon name="info" [size]="16" class="notice__icon" />
          <div class="notice__body">
            <p class="notice__title">Qué pasa cuando el AIU queda por debajo.</p>
            <p>
              Vendix NO emite la factura y NO infla la base por su cuenta: la
              rechaza indicando cuánto falta para llegar al piso. Inflarla en
              silencio cambiaría el importe que el cliente firmó.
            </p>
          </div>
        </div>
      </app-settings-section>

      <!-- Guardado propio: la cabecera del módulo manda todas las secciones de
           golpe y esta viaja sola, con sólo los campos que cambiaron. El aviso
           evita que el usuario espere el botón de arriba. -->
      <p class="page-actions__hint">
        Esta sección se guarda con su propio botón, no con el de la cabecera.
      </p>
      <div class="page-actions">
        @if (dirty()) {
          <span class="page-actions__badge">Cambios sin guardar</span>
        }
        <app-button
          variant="outline"
          [disabled]="!dirty() || saving()"
          (clicked)="discard()">
          Descartar
        </app-button>
        <app-button
          variant="primary"
          [loading]="saving()"
          [disabled]="!dirty() || blocked()"
          (clicked)="save()">
          Guardar
        </app-button>
      </div>
  `,
  styleUrls: ['../general/pages/_settings-page.scss'],
  styles: [
    `
      .regime-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .regime-card {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        text-align: left;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-background);
        padding: 12px 14px;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
      }

      .regime-card:hover:not(:disabled) {
        border-color: var(--color-primary);
      }

      .regime-card:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .regime-card--active {
        border-color: var(--color-primary);
        background: var(--color-surface);
      }

      .regime-card__mark {
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--color-text-muted);
      }

      .regime-card__mark--on {
        color: var(--color-primary);
      }

      .regime-card__body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .regime-card__title {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .regime-card__badge {
        margin-left: 6px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.1);
        border-radius: 9999px;
        padding: 1px 6px;
      }

      .regime-card__legal {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--color-text-muted);
      }

      .regime-card__base,
      .regime-card__scope {
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }

      .notice {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        border-radius: 12px;
        border: 1px solid var(--color-border);
        padding: 12px 14px;
        margin-top: 14px;
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--color-text-secondary);
      }

      .notice p {
        margin: 0;
      }

      .notice__icon {
        flex-shrink: 0;
        margin-top: 1px;
      }

      .notice__title {
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 2px;
      }

      .notice--danger {
        border-color: var(--color-destructive);
        background: rgba(239, 68, 68, 0.06);
      }

      .notice--danger .notice__icon {
        color: var(--color-destructive);
      }

      .notice--warning {
        border-color: var(--color-warning-500, #f59e0b);
        background: rgba(245, 158, 11, 0.08);
      }

      .notice--warning .notice__icon {
        color: var(--color-warning-600, #d97706);
      }

      .notice--info .notice__icon {
        color: var(--color-info-600);
      }

      .field-help {
        margin: 0 0 8px;
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--color-text-secondary);
      }

      .note-prefix {
        margin: 0 0 14px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px dashed var(--color-border);
        background: var(--color-background);
        font-size: 12.5px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .counter {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px;
        margin-top: 8px;
        font-size: 11.5px;
        color: var(--color-text-secondary);
      }

      .counter__value {
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .counter--bad .counter__value {
        color: var(--color-destructive);
      }

      .counter__hint {
        min-width: 0;
      }

      .preview-label {
        margin: 16px 0 6px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
      }

      .preview {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-background);
        border: 1px solid var(--color-border);
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }

      .preview--empty {
        color: var(--color-text-muted);
        font-style: italic;
      }

      .percent-field {
        margin-top: 14px;
        max-width: 220px;
      }

      .page-actions__hint {
        margin: 0 0 -6px;
        text-align: right;
        font-size: 11.5px;
        color: var(--color-text-muted);
      }

      .page-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
      }

      .page-actions__badge {
        margin-right: auto;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--color-warning-600, #d97706);
      }
    `,
  ],
})
export class AiuSettingsSection {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly toast = inject(ToastService);

  /**
   * El shell provee este store en la ruta padre y no renderiza el outlet hasta
   * que los settings cargaron, así que en el constructor ya hay datos. Se usa
   * para SEMBRAR (evita un GET duplicado) y para resincronizar su copia tras
   * guardar.
   */
  private readonly store = inject(GeneralSettingsStore);

  // Constantes expuestas al template. Vienen del espejo del backend: el
  // contador y la vista previa tienen que medir la misma cadena que viaja al XML.
  protected readonly notePrefix = DIAN_AIU_NOTE_PREFIX;
  protected readonly notePrefixLength = DIAN_AIU_NOTE_PREFIX.length;
  protected readonly noteMinLength = DIAN_AIU_NOTE_MIN_LENGTH;
  protected readonly noteMaxLength = DIAN_AIU_NOTE_MAX_LENGTH;

  protected readonly regimeOptions: readonly RegimeOption[] = [
    {
      value: 'et_462_1',
      label: 'Servicios del artículo 462-1',
      legal: 'E.T. art. 462-1',
      base: 'el AIU completo (Administración + Imprevistos + Utilidad)',
      scope:
        'Aseo y cafetería, vigilancia, servicios temporales de empleo y cooperativas de trabajo asociado. Lleva además un piso mínimo del 10 % del valor del contrato.',
      isDefault: true,
    },
    {
      value: 'decreto_1372_1992',
      label: 'Contratos de construcción de inmueble',
      legal: 'Decreto 1372/1992, art. 3',
      base: 'únicamente la Utilidad',
      scope:
        'Contratos de construcción de bien inmueble. La Administración y los Imprevistos quedan fuera de la base, así que el IVA facturado es sensiblemente menor.',
    },
  ];

  // ─── Estado del formulario ──────────────────────────────
  //
  // Señales planas en vez de un FormControl: un computed() no reacciona a un
  // FormControl, y todo lo de esta pantalla (contador, vista previa, campos
  // deshabilitados, botón de guardar) es derivado.

  protected readonly regime = signal<AiuRegime>(AIU_SETTINGS_DEFAULTS.regime);
  protected readonly contractObject = signal<string>(
    AIU_SETTINGS_DEFAULTS.contract_object,
  );
  protected readonly enforceMinimumBase = signal<boolean>(
    AIU_SETTINGS_DEFAULTS.enforce_minimum_base,
  );
  /** Se guarda como texto para conservar lo que el usuario tecleó, incluso inválido. */
  protected readonly minimumBasePercentInput = signal<string>(
    String(AIU_SETTINGS_DEFAULTS.minimum_base_percent),
  );

  /** Última versión confirmada por el backend. Es la referencia del diff. */
  private readonly persisted = signal<Required<AiuSettings>>(
    AIU_SETTINGS_DEFAULTS,
  );

  protected readonly saving = signal(false);

  constructor() {
    this.seed(this.store.settings().invoicing?.aiu);
  }

  // ─── Derivados ──────────────────────────────────────────

  protected readonly minimumBaseApplies = computed(
    () => this.regime() === 'et_462_1',
  );

  protected readonly toggleDescription = computed(() =>
    this.enforceMinimumBase()
      ? 'Al emitir, Vendix compara el AIU contra el piso y rechaza el documento si queda por debajo.'
      : 'Vendix emitirá con el AIU que traiga la factura, aunque quede por debajo del piso legal.',
  );

  /** La cadena EXACTA que el backend escribirá en el nodo de la nota. */
  protected readonly note = computed(() => buildAiuNote(this.contractObject()));

  protected readonly noteLength = computed(() => this.note().length);

  protected readonly noteTooShort = computed(
    () => this.noteLength() < DIAN_AIU_NOTE_MIN_LENGTH,
  );

  protected readonly noteLengthInvalid = computed(
    () => this.noteTooShort() || this.noteLength() > DIAN_AIU_NOTE_MAX_LENGTH,
  );

  protected readonly notePreview = computed(
    () =>
      this.note() ||
      'Describe el contrato arriba para ver la nota que llevará la factura.',
  );

  /**
   * Sólo bloquea el guardado lo que el backend rechazaría con un 400. Un objeto
   * vacío se puede guardar a propósito: configurar el régimen y describir el
   * contrato después es un orden razonable, y el aviso ya dice que hasta
   * entonces la emisión falla.
   */
  protected readonly contractObjectError = computed(() =>
    this.contractObject().trim().length > DIAN_AIU_CONTRACT_OBJECT_MAX_LENGTH
      ? 'Son ' +
        this.contractObject().trim().length +
        ' caracteres; el máximo es ' +
        DIAN_AIU_CONTRACT_OBJECT_MAX_LENGTH +
        ' para que la nota completa no supere ' +
        DIAN_AIU_NOTE_MAX_LENGTH +
        '.'
      : undefined,
  );

  private readonly percentValue = computed<number | null>(() => {
    const raw = this.minimumBasePercentInput().trim().replace(',', '.');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  });

  /**
   * Sólo se valida cuando el régimen lo usa: bajo el Decreto 1372/1992 el campo
   * está deshabilitado, y bloquear el guardado por un valor que ni se envía ni
   * se puede corregir dejaría la pantalla trabada.
   */
  protected readonly percentError = computed(() => {
    if (!this.minimumBaseApplies()) return undefined;
    const value = this.percentValue();
    if (value === null) return 'Escribe el porcentaje del piso legal.';
    if (value < 0 || value > 100) return 'Debe estar entre 0 y 100.';
    return undefined;
  });

  /**
   * Sólo lo que cambió. El backend mezcla `invoicing.aiu` por clave, así que
   * mandar de más es reescribir con valores viejos lo que otro proceso pudo
   * haber cambiado entre la carga y el guardado.
   */
  private readonly changes = computed<AiuSettings>(() => {
    const base = this.persisted();
    const payload: AiuSettings = {};

    if (this.regime() !== base.regime) {
      payload.regime = this.regime();
    }

    const contractObject = this.contractObject().trim();
    if (contractObject !== base.contract_object) {
      payload.contract_object = contractObject;
    }

    // Bajo el Decreto 1372/1992 estos dos no significan nada y los controles
    // están deshabilitados: no viajan.
    if (this.minimumBaseApplies()) {
      if (this.enforceMinimumBase() !== base.enforce_minimum_base) {
        payload.enforce_minimum_base = this.enforceMinimumBase();
      }
      const percent = this.percentValue();
      if (percent !== null && percent !== base.minimum_base_percent) {
        payload.minimum_base_percent = percent;
      }
    }

    return payload;
  });

  protected readonly dirty = computed(
    () => Object.keys(this.changes()).length > 0,
  );

  protected readonly blocked = computed(
    () =>
      this.saving() ||
      this.contractObjectError() !== undefined ||
      this.percentError() !== undefined,
  );

  // ─── Comandos ───────────────────────────────────────────

  protected onRegimeChange(next: AiuRegime): void {
    if (this.saving()) return;
    this.regime.set(next);
  }

  protected discard(): void {
    this.seed(this.persisted());
  }

  protected async save(): Promise<void> {
    if (this.blocked() || !this.dirty()) return;

    const payload = this.changes();
    this.saving.set(true);

    try {
      const response = await firstValueFrom(
        this.settingsService.saveSettingsNow({ invoicing: { aiu: payload } }),
      );

      // Se re-siembra desde la respuesta canónica del PATCH, no desde el estado
      // local: el backend puede normalizar valores y la pantalla debe quedar
      // mostrando lo que de verdad se persistió.
      const saved = response?.data?.invoicing?.aiu;
      this.seed(saved ?? { ...this.persisted(), ...payload });

      // La copia del shell queda rancia tras este PATCH, y volver a esta
      // pestaña la re-sembraría con los valores viejos. Se parchea sólo la
      // sección: `onSectionChange` marcaría el módulo como "pendiente de
      // guardar" por un cambio YA guardado, y `loadSettings` reemplazaría el
      // borrador completo, borrando lo que el usuario tuviera sin guardar en
      // las otras pestañas.
      this.store.settings.update((current) => ({
        ...current,
        invoicing: { ...(current.invoicing ?? {}), aiu: this.persisted() },
      }));

      this.toast.success('Configuración AIU guardada.');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  // ─── Internos ───────────────────────────────────────────

  /**
   * Normaliza lo que venga del backend (ausente, nulo o de un tenant sembrado a
   * mano) a los cuatro valores que la pantalla edita, y fija esa foto como
   * referencia del diff.
   */
  private seed(source: AiuSettings | undefined): void {
    const percent = source?.minimum_base_percent;

    const normalized: Required<AiuSettings> = {
      regime:
        source?.regime === 'decreto_1372_1992'
          ? 'decreto_1372_1992'
          : AIU_SETTINGS_DEFAULTS.regime,
      contract_object: (source?.contract_object ?? '').trim(),
      // Ausente significa el default del backend (true), no false.
      enforce_minimum_base:
        source?.enforce_minimum_base ??
        AIU_SETTINGS_DEFAULTS.enforce_minimum_base,
      minimum_base_percent:
        typeof percent === 'number' && Number.isFinite(percent)
          ? percent
          : AIU_SETTINGS_DEFAULTS.minimum_base_percent,
    };

    this.persisted.set(normalized);
    this.regime.set(normalized.regime);
    this.contractObject.set(normalized.contract_object);
    this.enforceMinimumBase.set(normalized.enforce_minimum_base);
    this.minimumBasePercentInput.set(String(normalized.minimum_base_percent));
  }
}
