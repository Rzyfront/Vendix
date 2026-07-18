import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

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
  readonly icon:
    | 'square-menu'
    | 'users'
    | 'utensils-crossed'
    | 'user-check';
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
    icon: 'square-menu',
  },
  {
    value: 'mark_occupied',
    title: 'Marcar mesa ocupada',
    description:
      'La mesa se marca como ocupada al escanear; el mesero abre la cuenta después.',
    icon: 'users',
  },
  {
    value: 'open_tab',
    title: 'Abrir cuenta',
    description:
      'Se abre una cuenta (borrador de pedido) automáticamente para que el cliente pida directo.',
    icon: 'utensils-crossed',
  },
  {
    value: 'require_staff',
    title: 'Requiere mesero',
    description:
      'El cliente puede escanear pero no pedir hasta que un mesero asignado apruebe la apertura.',
    icon: 'user-check',
  },
];

@Component({
  selector: 'app-restaurant-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, ToggleComponent, IconComponent],
  templateUrl: './restaurant-settings-form.component.html',
  styles: [
    `
      :host {
        display: block;
      }

      .qr-behavior-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }

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
    `,
  ],
})
export class RestaurantSettingsForm {
  readonly settings = input.required<RestaurantSettings>();
  readonly settingsChange = output<RestaurantSettings>();

  readonly qrScanBehaviors = QR_SCAN_BEHAVIORS;

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
      }
    });
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as RestaurantSettings);
    }
  }
}
