/**
 * Panel de cambios de la edición masiva de clientes.
 *
 * ## Por qué el estado no vive aquí
 *
 * El `FormGroup` y el conjunto de campos activados los crea la PÁGINA, porque es
 * la que construye el payload de `preview`/`apply`. Este componente recibe el
 * `FormGroup` como input (los controles existen desde el principio) y el
 * conjunto de activados como `model`, así que escribe sobre la señal del padre
 * sin outputs intermedios.
 *
 * ## Sin validadores globales — decisión deliberada
 *
 * Ningún control lleva `Validators`: el panel edita un SUBCONJUNTO de campos de
 * N clientes distintos, así que "validar el cliente completo" no está definido.
 * Las reglas cruzadas (persona jurídica ↔ razón social, tipo de documento ↔
 * persona, tarifa de la tienda) las evalúa el backend fila por fila, y el
 * preview las devuelve como `warning`/`error` ANTES de escribir nada.
 *
 * ## La tarifa es un campo más, pero con su propio control
 *
 * `price_tier_id` se pinta con `app-selector` y una opción explícita «Sin
 * tarifa». No es un multi-selector porque el modelo guarda UN valor por cliente
 * y tienda: el panel ofrece asignar o limpiar, no acumular.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  type SelectorOption,
} from '../../../../../shared/components/index';
import { BulkCustomerFieldControlComponent } from './bulk-customer-field-control.component';
import {
  BulkCustomerField,
  BulkCustomerFieldKey,
  getBulkCustomerGroups,
} from './bulk-editable-customer-fields.constant';

@Component({
  selector: 'app-bulk-customer-changes-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    BulkCustomerFieldControlComponent,
  ],
  templateUrl: './bulk-customer-changes-panel.component.html',
})
export class BulkCustomerChangesPanelComponent {
  /** `FormGroup` con un control por campo del contrato. Lo crea la página. */
  readonly form = input.required<FormGroup>();
  /** Cuántos clientes hay en la selección, para el aviso de alcance. */
  readonly selectionCount = input<number>(0);
  /** Catálogo de tarifas de cliente de la tienda. */
  readonly priceTiers = input<readonly SelectorOption[]>([]);
  /** Catálogo de etiquetas del CRM de la tienda. */
  readonly crmTags = input<readonly SelectorOption[]>([]);

  /** Campos que el usuario activó explícitamente. */
  readonly activeFields = model<ReadonlySet<BulkCustomerFieldKey>>(
    new Set<BulkCustomerFieldKey>(),
  );

  readonly resetRequested = output<void>();

  /** Bloques con sus campos, en el orden del registro. */
  readonly groups = getBulkCustomerGroups();

  /**
   * Configuraciones activadas que EXISTEN en el contrato. Se cuenta contra el
   * registro y no contra el `Set` crudo para no anunciar campos fantasma.
   */
  readonly activeCount = computed<number>(() => {
    const active = this.activeFields();
    let count = 0;
    for (const group of this.groups) {
      for (const field of group.fields) {
        if (active.has(field.key)) count += 1;
      }
    }
    return count;
  });

  isActive(key: BulkCustomerFieldKey): boolean {
    return this.activeFields().has(key);
  }

  /** Catálogo dinámico que le toca al campo según su `optionsRef`. */
  dynamicOptionsFor(field: BulkCustomerField): readonly SelectorOption[] {
    switch (field.optionsRef) {
      case 'price-tiers':
        return this.priceTiers();
      case 'crm-tags':
        return this.crmTags();
      default:
        return [];
    }
  }

  /**
   * Activa/desactiva un campo. Publica SIEMPRE un `Set` nuevo: mutar el
   * existente no cambiaría la referencia y la señal no notificaría a nadie.
   */
  onFieldActiveChange(key: BulkCustomerFieldKey, next: boolean): void {
    const current = new Set(this.activeFields());
    if (next) {
      current.add(key);
    } else {
      current.delete(key);
      this.resetControl(key);
    }
    this.activeFields.set(current);
  }

  /**
   * Al desactivar un campo se limpia su control: si no se limpiara, reactivarlo
   * más tarde lo reabriría con un valor que el usuario ya había descartado — y
   * ese valor SÍ viajaría al backend.
   */
  private resetControl(key: BulkCustomerFieldKey): void {
    const control = this.form().get(key);
    if (!control) return;
    if (control instanceof FormGroup) {
      control.reset({ mode: 'add', ids: [] });
      return;
    }
    control.reset();
  }
}
