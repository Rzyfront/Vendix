import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';

export type QrScanBehavior = 'menu_only' | 'mark_occupied' | 'open_tab' | 'require_staff';

export interface RestaurantSettings {
  enable_table_checkout: boolean;
  qr_scan_behavior?: QrScanBehavior;
  qr_auto_fire?: boolean;
}

interface QrScanBehaviorOption {
  readonly value: QrScanBehavior;
  readonly title: string;
  readonly description: string;
  /**
   * Lo que el comensal ve en la pantalla de su teléfono al escanear. Es la
   * lectura que le falta al operador para elegir modo sin adivinar.
   */
  readonly guest: string;
  /**
   * `true` cuando el modo habilita el auto-pedido del comensal. El backend
   * rechaza `addOrderItems` con 409 en los modos que lo tienen en `false`
   * (ver `EcommerceTablesService.addOrderItems`).
   */
  readonly allowsSelfOrder: boolean;
  readonly badge?: { readonly text: string; readonly variant: BadgeVariant };
  /** Nombre registrado en `icons.registry.ts` — los no registrados caen al genérico. */
  readonly icon: 'book-open' | 'users' | 'receipt' | 'user-check';
}

// Canonical descriptions kept in sync with:
//   apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts
//     → RestaurantSettingsDto.qr_scan_behavior @ApiProperty descriptions.
//   apps/backend/src/domains/ecommerce/tables/ecommerce-tables.service.ts
//     → EcommerceTablesService.resolveByToken JSDoc per-case behavior.
const QR_SCAN_BEHAVIORS: ReadonlyArray<QrScanBehaviorOption> = [
  {
    value: 'menu_only',
    title: 'Solo carta',
    description:
      'El cliente ve la carta digital sin modificar el estado de la mesa.',
    guest:
      'Ve la carta y los precios. No puede pedir ni abrir cuenta: llama al mesero como siempre.',
    allowsSelfOrder: false,
    badge: { text: 'Por defecto', variant: 'info' },
    icon: 'book-open',
  },
  {
    value: 'mark_occupied',
    title: 'Marcar mesa ocupada',
    description:
      'La mesa se marca como ocupada al escanear; el mesero abre la cuenta después.',
    guest:
      'Ve la carta. No puede pedir, pero la mesa ya aparece ocupada en el salón para tu equipo.',
    allowsSelfOrder: false,
    icon: 'users',
  },
  {
    value: 'open_tab',
    title: 'Abrir cuenta',
    description:
      'Se abre una cuenta (borrador de pedido) automáticamente para que el cliente pida directo.',
    guest:
      'Ve la carta y puede agregar platos a su propia cuenta sin esperar a nadie.',
    allowsSelfOrder: true,
    badge: { text: 'El cliente pide solo', variant: 'warning' },
    icon: 'receipt',
  },
  {
    value: 'require_staff',
    title: 'Requiere mesero',
    description:
      'El cliente puede escanear pero no pedir hasta que un mesero asignado apruebe la apertura.',
    guest:
      'Ve la carta y queda esperando: tu equipo recibe el aviso y un mesero confirma la apertura de la cuenta.',
    allowsSelfOrder: true,
    icon: 'user-check',
  },
];

@Component({
  selector: 'app-restaurant-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ToggleComponent,
    IconComponent,
    AlertBannerComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
  ],
  templateUrl: './restaurant-settings-form.component.html',
  styles: [
    `
      :host {
        display: block;
      }

      .settings-kicker {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 6px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted, #94a3b8);
      }

      .settings-kicker app-icon {
        color: var(--color-primary, #2563eb);
      }

      .settings-hint {
        margin: 0 0 14px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-text-secondary, #6b7280);
      }

      /* El <code> también aparece proyectado dentro del app-alert-banner, así
         que el selector no puede colgar de .settings-hint. */
      .restaurant-settings-form code {
        padding: 1px 5px;
        border-radius: 5px;
        background: var(--color-neutral-100, #f1f5f9);
        border: 1px solid var(--color-border, #e5e7eb);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          monospace;
        font-size: 11px;
      }

      .setting-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid var(--color-border, #e5e7eb);
        background: var(--color-neutral-100, #f1f5f9);
      }

      .setting-row__copy {
        flex: 1;
        min-width: 0;
      }

      .setting-row__label {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary, #111827);
      }

      .setting-row__desc {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-text-secondary, #6b7280);
      }

      .setting-row__list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 8px 0 0;
        padding-left: 16px;
        font-size: 11px;
        line-height: 1.45;
        color: var(--color-text-secondary, #6b7280);
      }

      .help-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted, #94a3b8);
        cursor: help;
      }

      .help-icon:hover {
        color: var(--color-info, #3b82f6);
      }

      .help-card-header {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        text-align: left;
        color: var(--color-text-primary, #111827);
      }

      .help-card-header app-icon {
        flex-shrink: 0;
        color: var(--color-info, #3b82f6);
      }

      .help-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .help-list li {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-text-secondary, #6b7280);
      }

      .help-list app-icon {
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--color-text-muted, #94a3b8);
      }

      .help-list strong {
        color: var(--color-text-primary, #111827);
        font-weight: 600;
      }

      .qr-behavior-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }

      .qr-behavior-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 14px 16px;
        border-radius: 12px;
        border: 1px solid var(--color-border, #e5e7eb);
        background: var(--color-surface, #ffffff);
        color: var(--color-text-primary, #111827);
        text-align: left;
        cursor: pointer;
        transition: border-color 0.18s ease, background-color 0.18s ease,
          box-shadow 0.18s ease;
      }

      .qr-behavior-card:hover {
        border-color: var(--color-primary, #2563eb);
      }

      .qr-behavior-card.selected {
        border-color: var(--color-primary, #2563eb);
        background: rgba(var(--color-primary-rgb, 37 99 235), 0.06);
        box-shadow: 0 0 0 1px var(--color-primary, #2563eb);
      }

      .qr-behavior-card .qr-behavior-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: rgba(var(--color-primary-rgb, 37 99 235), 0.1);
        color: var(--color-primary, #2563eb);
      }

      .qr-behavior-card .qr-behavior-check {
        position: absolute;
        top: 10px;
        right: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: var(--color-primary, #2563eb);
        color: #ffffff;
      }

      .qr-behavior-card .qr-behavior-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.25;
        color: var(--color-text-primary, #111827);
      }

      .qr-behavior-card .qr-behavior-desc {
        margin: 0;
        font-size: 12px;
        line-height: 1.35;
        color: var(--color-text-secondary, #6b7280);
      }

      /* Lo que ve el comensal: se separa de la descripción operativa con un
         filete para que se lea como "la otra cara" de la misma tarjeta. */
      .qr-behavior-card .qr-behavior-guest {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 2px 0 0;
        padding-top: 8px;
        border-top: 1px dashed var(--color-border, #e5e7eb);
        font-size: 11px;
        line-height: 1.4;
        color: var(--color-text-secondary, #6b7280);
      }

      .qr-behavior-card .qr-behavior-guest app-icon {
        flex-shrink: 0;
        margin-top: 1px;
        color: var(--color-text-muted, #94a3b8);
      }

      .qr-behavior-card .qr-behavior-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      /* Overrides responsive — SIEMPRE al final del bloque de estilos. */
      @media (min-width: 640px) {
        .qr-behavior-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1280px) {
        .qr-behavior-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class RestaurantSettingsForm {
  readonly settings = input.required<RestaurantSettings>();
  readonly settingsChange = output<RestaurantSettings>();

  readonly qrScanBehaviors = QR_SCAN_BEHAVIORS;

  /**
   * Espejos en señal del formulario. Los FormControl no son señales: leerlos
   * dentro de un `computed` lo congelaría en el valor inicial, y el aviso de
   * auto-disparo depende justamente de la combinación vigente.
   */
  readonly selectedBehavior = signal<QrScanBehavior>('menu_only');
  readonly autoFire = signal(false);

  /** Panel colapsable con el recorrido completo del QR de mesa. */
  readonly qrHelpOpen = signal(false);

  /** Metadatos del modo seleccionado, para el aviso contextual. */
  readonly selectedBehaviorOption = computed(
    () =>
      QR_SCAN_BEHAVIORS.find((opt) => opt.value === this.selectedBehavior()) ??
      QR_SCAN_BEHAVIORS[0],
  );

  /**
   * El auto-disparo sólo actúa cuando el comensal AGREGA platos a la cuenta, y
   * eso únicamente los modos `open_tab` y `require_staff` lo permiten (el resto
   * responde 409). Con `menu_only` o `mark_occupied` el interruptor queda
   * encendido y sin efecto: hay que decirlo, no dejar que lo descubra un lunes.
   */
  readonly autoFireHasNoEffect = computed(
    () => this.autoFire() && !this.selectedBehaviorOption().allowsSelfOrder,
  );

  form: FormGroup = new FormGroup({
    enable_table_checkout: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
    qr_scan_behavior: new FormControl<QrScanBehavior>('menu_only', {
      nonNullable: true,
    }),
    qr_auto_fire: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
  });

  get enableTableCheckoutControl(): FormControl<boolean> {
    return this.form.get('enable_table_checkout') as FormControl<boolean>;
  }

  get qrScanBehaviorControl(): FormControl<QrScanBehavior> {
    return this.form.get('qr_scan_behavior') as FormControl<QrScanBehavior>;
  }

  get qrAutoFireControl(): FormControl<boolean> {
    return this.form.get('qr_auto_fire') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
        this.syncMirrors();
      }
    });
  }

  onFieldChange() {
    this.syncMirrors();
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as RestaurantSettings);
    }
  }

  /** Empuja el estado del formulario a las señales que lee la plantilla. */
  private syncMirrors(): void {
    this.selectedBehavior.set(this.qrScanBehaviorControl.value ?? 'menu_only');
    this.autoFire.set(this.qrAutoFireControl.value === true);
  }
}
