import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../shared/components/setting-toggle/setting-toggle.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { SettingsSectionComponent } from '../general/components/settings-section/settings-section.component';
import { GeneralSettingsStore } from '../general/services/general-settings.store';
import { StoreSettingsService } from '../general/services/store-settings.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  ECOMMERCE_INVOICING_SETTINGS_DEFAULTS,
  EcommerceInvoicingSettings,
  POS_INVOICING_SETTINGS_DEFAULTS,
  PosDianFailurePolicy,
  PosInvoicingSettings,
} from '../../../../../core/models/store-settings.interface';

/** Una política de fallo, con la consecuencia operativa por delante de la etiqueta. */
interface FailurePolicyOption {
  readonly value: PosDianFailurePolicy;
  readonly label: string;
  readonly effect: string;
  readonly detail: string;
  readonly isDefault?: boolean;
}

/**
 * Emisión automática de factura — sección UNIFICADA de los DOS carriles de
 * venta: mostrador (POS) y tienda en línea (e-commerce). Hoy vive montada en
 * la pestaña «Venta» y, transitoriamente, también en la sub-pestaña «Caja» de
 * «Facturación» (esa segunda ubicación se retira en un paso posterior — no es
 * tarea de este componente).
 *
 * ## Qué es configurable acá y qué NO
 *
 * Configurable: si la venta de mostrador dispara el documento electrónico
 * sola (`invoicing.pos.auto_emit`), si el pedido en línea hace lo mismo
 * (`invoicing.ecommerce.auto_emit`), y qué se hace en el mostrador cuando la
 * DIAN no acepta el documento (`invoicing.pos.on_failure`).
 *
 * NO configurable —y no es un olvido—: que el fallo BLOQUEE la venta. El
 * evento que dispara la emisión de mostrador se emite después de CERRAR la
 * venta (al cobrar, o al confirmar una venta a crédito que se cierra sin
 * cobrar), así que cuando esta preferencia se lee ya no queda venta que
 * bloquear. Ofrecer un «bloquear» obligaría a emitir dentro de la transacción
 * de cierre, que es exactamente lo que este carril existe para evitar: el
 * cajero tiene fila y la DIAN tarda. `on_failure` es EXCLUSIVO del mostrador:
 * no existe (todavía) una política de fallo configurable para e-commerce.
 *
 * ## Por qué guarda por su cuenta
 *
 * Igual que la sección AIU: el botón de la cabecera manda TODAS las secciones
 * del borrador de golpe, y acá viaja sólo lo que cambió, por sub-clave:
 * `{ invoicing: { pos?: <diff>, ecommerce?: <diff> } }`. El backend mezcla
 * `invoicing` POR SUB-CLAVE, así que reenviar un bloque completo (o el que no
 * cambió) reescribiría con valores viejos lo que otra pantalla acabara de
 * cambiar. Cada carril mantiene su propio `persisted` — la foto de referencia
 * del diff — precisamente para que el diff de uno nunca dependa del otro.
 */
@Component({
  selector: 'app-pos-invoicing-settings-section',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    SettingToggleComponent,
    SettingsSectionComponent,
  ],
  template: `
    <app-settings-section
      anchorId="section-pos-invoicing"
      icon="receipt"
      iconTone="green"
      title="Emisión automática de factura"
      hint="Gobierna los dos carriles de venta de la tienda: mostrador (POS) y tienda en línea. Cada uno se enciende o apaga por separado.">
      <app-setting-toggle
        label="Venta en mostrador (POS)"
        [description]="posAutoEmitDescription()"
        [disabled]="saving()"
        [ngModel]="autoEmit()"
        (ngModelChange)="autoEmit.set($event)" />

      <app-setting-toggle
        label="Tienda en línea"
        [description]="ecommerceAutoEmitDescription()"
        [disabled]="saving()"
        [ngModel]="ecommerceAutoEmit()"
        (ngModelChange)="ecommerceAutoEmit.set($event)" />

      <p class="field-label">Mostrador (POS)</p>

      <div class="notice notice--info">
        <app-icon name="info" [size]="16" class="notice__icon" />
        <div class="notice__body">
          <p class="notice__title">El cobro nunca queda esperando.</p>
          <p>
            En el mostrador, la emisión ocurre después de cerrar la venta —al
            cobrar, o al confirmar una venta a crédito que se cierra sin
            cobrar—, nunca dentro de esa operación. Si la DIAN tarda o rechaza,
            la venta ya está cerrada y el cajero puede seguir atendiendo: el
            indicador fiscal del POS avisa sin interrumpir y nunca exige un
            clic para continuar.
          </p>
        </div>
      </div>

      <p class="field-label">Cuando el documento del mostrador no se pueda emitir</p>
      <div
        class="policy-options"
        role="radiogroup"
        aria-label="Qué hacer cuando la emisión falla">
        @for (option of failurePolicyOptions; track option.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="onFailure() === option.value"
            [disabled]="saving()"
            (click)="onPolicyChange(option.value)"
            class="policy-card"
            [class.policy-card--active]="onFailure() === option.value">
            <app-icon
              [name]="onFailure() === option.value ? 'check-circle' : 'circle'"
              [size]="18"
              [class]="
                onFailure() === option.value
                  ? 'policy-card__mark policy-card__mark--on'
                  : 'policy-card__mark'
              " />
            <span class="policy-card__body">
              <span class="policy-card__title">
                {{ option.label }}
                @if (option.isDefault) {
                  <span class="policy-card__badge">Recomendado</span>
                }
              </span>
              <span class="policy-card__effect">{{ option.effect }}</span>
              <span class="policy-card__detail">{{ option.detail }}</span>
            </span>
          </button>
        }
      </div>

      @if (onFailure() === 'ignore') {
        <div class="notice notice--danger">
          <app-icon name="alert-triangle" [size]="16" class="notice__icon" />
          <div class="notice__body">
            <p class="notice__title">Sin constancia, el fallo se pierde.</p>
            <p>
              El indicador del POS desaparece en cuanto empieza la siguiente
              venta. Si el fallo no queda registrado, esa venta se queda sin
              documento electrónico y nadie se entera hasta que alguien cruce las
              ventas con las facturas — normalmente, al cerrar el mes.
            </p>
          </div>
        </div>
      }

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
          [disabled]="!dirty() || saving()"
          (clicked)="save()">
          Guardar
        </app-button>
      </div>
    </app-settings-section>
  `,
  styles: [
    `
      .field-label {
        margin: 18px 0 8px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
      }

      .policy-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .policy-card {
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

      .policy-card:hover:not(:disabled) {
        border-color: var(--color-primary);
      }

      .policy-card:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      /*
       * NINGÚN ACENTO GRAVE ACÁ DENTRO: esto vive en un template string de
       * TypeScript y un solo acento grave lo cierra, con cascada de errores
       * falsos en todo el archivo.
       *
       * El activo se tiñe con el primario, no se aclara. Con background
       * var(--color-surface) la tarjeta elegida quedaba del mismo color que el
       * panel que la contiene y la única señal de selección era el borde: en la
       * lista de dos, con ambas del mismo tono, había que mirar el icono para
       * saber cuál estaba puesta.
       */
      .policy-card--active {
        border-color: var(--color-primary);
        background: rgba(var(--color-primary-rgb), 0.07);
        box-shadow: 0 0 0 1px var(--color-primary) inset;
      }

      .policy-card__mark {
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--color-text-muted);
      }

      .policy-card__mark--on {
        color: var(--color-primary);
      }

      .policy-card__body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .policy-card__title {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .policy-card__badge {
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

      .policy-card__effect,
      .policy-card__detail {
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

      .notice--info .notice__icon {
        color: var(--color-info-600);
      }

      .notice--danger {
        border-color: var(--color-destructive);
        background: rgba(239, 68, 68, 0.06);
      }

      .notice--danger .notice__icon {
        color: var(--color-destructive);
      }

      .page-actions__hint {
        margin: 18px 0 -6px;
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
        margin-top: 10px;
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
export class PosInvoicingSettingsSection {
  private readonly settingsService = inject(StoreSettingsService);
  private readonly toast = inject(ToastService);

  /**
   * El shell provee este store en la ruta padre y no renderiza el outlet hasta
   * que los settings cargaron: en el constructor ya hay datos con los que
   * sembrar, sin un GET extra.
   */
  private readonly store = inject(GeneralSettingsStore);

  protected readonly failurePolicyOptions: readonly FailurePolicyOption[] = [
    {
      value: 'queue',
      label: 'Dejar constancia del fallo',
      effect: 'La venta se cierra igual y el documento queda registrado como pendiente de resolver.',
      detail:
        'Aparece en el indicador del POS, en el estado de la factura y en la cola de reintentos, con el motivo exacto. Lo transitorio se reintenta solo; lo que falta corregir espera a que alguien lo corrija.',
      isDefault: true,
    },
    {
      value: 'ignore',
      label: 'Sólo registrar en el log',
      effect: 'La venta se cierra igual y el fallo no queda en ninguna pantalla.',
      detail:
        'Únicamente para tiendas que concilian la facturación por fuera de Vendix. El fallo seguirá en el log del servidor, pero ninguna pantalla del producto lo mostrará.',
    },
  ];

  // Señales planas: todo lo que el template lee es derivado, y un FormControl
  // no dispara `computed()`.
  protected readonly autoEmit = signal<boolean>(
    POS_INVOICING_SETTINGS_DEFAULTS.auto_emit,
  );
  protected readonly onFailure = signal<PosDianFailurePolicy>(
    POS_INVOICING_SETTINGS_DEFAULTS.on_failure,
  );
  protected readonly ecommerceAutoEmit = signal<boolean>(
    ECOMMERCE_INVOICING_SETTINGS_DEFAULTS.auto_emit,
  );

  /** Última versión confirmada por el backend para el mostrador. Referencia del diff. */
  private readonly persisted = signal<Required<PosInvoicingSettings>>(
    POS_INVOICING_SETTINGS_DEFAULTS,
  );

  /**
   * Última versión confirmada por el backend para la tienda en línea.
   * Referencia del diff de ese carril — SEPARADA de `persisted` a propósito:
   * el diff de un carril no debe depender del estado del otro.
   */
  private readonly persistedEcommerce = signal<Required<EcommerceInvoicingSettings>>(
    ECOMMERCE_INVOICING_SETTINGS_DEFAULTS,
  );

  protected readonly saving = signal(false);

  constructor() {
    this.seedPos(this.store.settings().invoicing?.pos);
    this.seedEcommerce(this.store.settings().invoicing?.ecommerce);
  }

  protected readonly posAutoEmitDescription = computed(() =>
    this.autoEmit()
      ? 'Al cerrar la venta en el mostrador, Vendix emite el documento electrónico sin que el cajero haga nada — también en una venta a crédito, que se cierra sin cobrar.'
      : 'El cajero cierra la venta y el documento se emite después, a mano, desde el detalle del pedido.',
  );

  protected readonly ecommerceAutoEmitDescription = computed(() =>
    this.ecommerceAutoEmit()
      ? 'Al cerrarse un pedido de la tienda en línea, Vendix emite el documento electrónico automáticamente, sin que nadie tenga que pedirlo.'
      : 'El pedido se cierra igual y el documento se emite después, a mano, desde el detalle del pedido.',
  );

  /**
   * Sólo lo que cambió del mostrador: el backend mezcla `invoicing.pos` por
   * clave, así que mandar de más reescribe con valores viejos lo que otro
   * proceso pudo haber cambiado entre la carga y el guardado.
   */
  private readonly posChanges = computed<PosInvoicingSettings>(() => {
    const base = this.persisted();
    const payload: PosInvoicingSettings = {};

    if (this.autoEmit() !== base.auto_emit) {
      payload.auto_emit = this.autoEmit();
    }
    if (this.onFailure() !== base.on_failure) {
      payload.on_failure = this.onFailure();
    }

    return payload;
  });

  /** Igual que `posChanges`, pero para `invoicing.ecommerce`. */
  private readonly ecommerceChanges = computed<EcommerceInvoicingSettings>(() => {
    const base = this.persistedEcommerce();
    const payload: EcommerceInvoicingSettings = {};

    if (this.ecommerceAutoEmit() !== base.auto_emit) {
      payload.auto_emit = this.ecommerceAutoEmit();
    }

    return payload;
  });

  protected readonly dirty = computed(
    () =>
      Object.keys(this.posChanges()).length > 0 ||
      Object.keys(this.ecommerceChanges()).length > 0,
  );

  protected onPolicyChange(next: PosDianFailurePolicy): void {
    if (this.saving()) return;
    this.onFailure.set(next);
  }

  protected discard(): void {
    this.seedPos(this.persisted());
    this.seedEcommerce(this.persistedEcommerce());
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.dirty()) return;

    const posPayload = this.posChanges();
    const ecommercePayload = this.ecommerceChanges();

    // Sólo las sub-claves con cambios: si únicamente cambió un carril, el
    // otro NO viaja en el body — mandarlo de más reescribiría con valores
    // viejos lo que otra pantalla acabara de cambiar en esa sub-clave.
    const invoicing: { pos?: PosInvoicingSettings; ecommerce?: EcommerceInvoicingSettings } = {};
    if (Object.keys(posPayload).length > 0) {
      invoicing.pos = posPayload;
    }
    if (Object.keys(ecommercePayload).length > 0) {
      invoicing.ecommerce = ecommercePayload;
    }

    this.saving.set(true);

    try {
      const response = await firstValueFrom(
        this.settingsService.saveSettingsNow({ invoicing }),
      );

      // Se re-siembra desde la respuesta canónica del PATCH y no desde el
      // estado local: el backend normaliza, y la pantalla debe quedar
      // mostrando lo que de verdad se persistió. Cada carril se re-siembra
      // con su propia sub-clave, presente o no en la respuesta.
      const savedPos = response?.data?.invoicing?.pos;
      const savedEcommerce = response?.data?.invoicing?.ecommerce;
      this.seedPos(savedPos ?? { ...this.persisted(), ...posPayload });
      this.seedEcommerce(
        savedEcommerce ?? { ...this.persistedEcommerce(), ...ecommercePayload },
      );

      // La copia del shell queda rancia tras el PATCH y volver a esta pestaña
      // la re-sembraría con los valores viejos. Se parchea sólo esta sección
      // (las dos sub-claves): recargar el borrador completo borraría lo que
      // el usuario tenga sin guardar en las otras pestañas.
      this.store.settings.update((current) => ({
        ...current,
        invoicing: {
          ...(current.invoicing ?? {}),
          pos: this.persisted(),
          ecommerce: this.persistedEcommerce(),
        },
      }));

      this.toast.success('Configuración de emisión automática guardada.');
    } catch (error) {
      this.toast.error(parseApiError(error).userMessage);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Normaliza lo que venga del backend (ausente, nulo, o escrito a mano en el
   * JSON) a los dos valores que la pantalla edita para el mostrador, y fija
   * esa foto como referencia del diff. Un `on_failure` fuera del dominio cae
   * al default, que es el que SÍ deja constancia.
   */
  private seedPos(source: PosInvoicingSettings | undefined): void {
    const normalized: Required<PosInvoicingSettings> = {
      // Ausente significa el default del backend (true), no false.
      auto_emit:
        source?.auto_emit ?? POS_INVOICING_SETTINGS_DEFAULTS.auto_emit,
      on_failure:
        source?.on_failure === 'ignore'
          ? 'ignore'
          : POS_INVOICING_SETTINGS_DEFAULTS.on_failure,
    };

    this.persisted.set(normalized);
    this.autoEmit.set(normalized.auto_emit);
    this.onFailure.set(normalized.on_failure);
  }

  /** Igual que `seedPos`, pero para el carril de tienda en línea. */
  private seedEcommerce(source: EcommerceInvoicingSettings | undefined): void {
    const normalized: Required<EcommerceInvoicingSettings> = {
      // Ausente significa el default del backend (true), no false.
      auto_emit:
        source?.auto_emit ?? ECOMMERCE_INVOICING_SETTINGS_DEFAULTS.auto_emit,
    };

    this.persistedEcommerce.set(normalized);
    this.ecommerceAutoEmit.set(normalized.auto_emit);
  }
}
