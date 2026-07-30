/**
 * Panel de cambios de la edición masiva (QUI-567).
 *
 * ## El tipo objetivo conduce el catálogo
 *
 * Arriba del panel vive el selector de `product_type`. No es un campo más: es
 * el conductor. Cambiarlo recalcula qué grupos y qué campos existen, porque el
 * registro (`bulk-editable-fields.constant.ts`) declara para cada campo a qué
 * `product_type` aplica. Es la petición central del usuario: "si estoy
 * configurando el producto como producto me salen todas las configuraciones que
 * le puedo cambiar; si selecciono que todos van a ser un servicio, salen todas
 * las configuraciones que puede llevar como servicio".
 *
 * Elegir el tipo objetivo NO implica cambiarlo en los productos: son dos cosas
 * distintas y se piden por separado. El selector siempre filtra el catálogo,
 * pero `product_type` solo viaja en `changes` si su casilla de activación está
 * marcada, exactamente igual que los otros 33 campos. Así "quiero ver qué le
 * puedo cambiar a mis servicios" no acaba convirtiendo 100 productos en
 * servicios.
 *
 * ## Por qué el estado no vive aquí
 *
 * El `FormGroup` y el conjunto de campos activados los crea la PÁGINA, porque es
 * la que tiene que construir el payload de `preview`/`apply`. Este componente
 * recibe el `FormGroup` como input (los controles existen desde el principio;
 * ninguno se crea ni se destruye al navegar el catálogo) y el conjunto de
 * activados como `model`, así que escribe sobre la señal del padre sin outputs
 * intermedios.
 *
 * ## Sin validadores globales — decisión deliberada
 *
 * Ningún control lleva `Validators`. En este repo un validador global sobre
 * campos condicionales ya produjo un bloqueo irresoluble que `resetUomControls()`
 * tuvo que mitigar en el formulario individual: el usuario no podía guardar por
 * un campo que su configuración ni siquiera mostraba. Aquí el criterio es más
 * fuerte todavía, porque el panel edita un SUBCONJUNTO de campos de N productos
 * distintos: validar "el producto completo" es literalmente imposible. Las
 * reglas cruzadas las evalúa el backend producto a producto y el preview las
 * devuelve como `warning`/`error` ANTES de escribir nada.
 *
 * ## Zona peligrosa (QUI-567 paso 13)
 *
 * Al final del panel, visualmente separada del resto, vive la acción de ELIMINAR
 * los productos seleccionados. Está aquí y no en el `app-sticky-header` por dos
 * razones:
 *
 *  1. **Distancia física del camino habitual.** La acción de guardar vive arriba,
 *     en el header, y se pulsa muchas veces al día. Poner al lado un botón que
 *     elimina 100 productos de forma irreversible es un accidente esperando su
 *     turno. Al final del panel hay que hacer scroll para llegar.
 *  2. **Es una acción del conjunto seleccionado, igual que los cambios.** Habita
 *     el mismo contexto: "esto es lo que le voy a hacer a estos N productos".
 *
 * El bloque NO llama al servicio: emite `archiveRequested` y la PÁGINA abre el
 * modal de confirmación. Es el mismo reparto que el resto del módulo (la página
 * orquesta, los paneles presentan), y aquí importa más que en ningún otro sitio:
 * la escritura tiene que pasar por la confirmación reforzada, y un componente de
 * presentación que pudiera invocar el archivado por su cuenta sería una segunda
 * puerta sin candado.
 *
 * El permiso llega como input (`canArchive`) resuelto por la página, igual que
 * `products.component.ts` resuelve `canBulkEditProducts` y lo baja a
 * `product-list` como `[canBulkEdit]`. Es afordancia de UI: el permiso real lo
 * impone el backend (`store:products:admin_delete`, reforzado por nombre en
 * `products-bulk-edit.controller.ts`).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputButtonsComponent,
  InputsearchComponent,
  type InputButtonOption,
  type SelectorOption,
} from '../../../../../shared/components/index';
import { BulkEditFieldControlComponent } from './bulk-edit-field-control.component';
import type {
  BulkEditFieldOption,
  BulkEditVisibleGroup,
  BulkEditableField,
  BulkEditableFieldKey,
} from './bulk-edit.interface';

/** Clave del campo conductor. El panel la trata aparte del `@for` de grupos. */
const TYPE_FIELD_KEY: BulkEditableFieldKey = 'product_type';

/**
 * Normaliza para comparar: minúsculas y sin tildes. Las etiquetas del registro
 * están en español ("Precio de oferta", "Duración", "Preparación"), así que sin
 * quitar diacríticos buscar "duracion" no encontraría "Duración" — y nadie
 * escribe tildes en un buscador.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** ¿Alguno de los textos contiene el término ya normalizado? */
function matches(term: string, ...texts: (string | undefined)[]): boolean {
  return texts.some((text) => !!text && normalize(text).includes(term));
}

@Component({
  selector: 'app-bulk-changes-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    ButtonComponent,
    InputButtonsComponent,
    InputsearchComponent,
    BulkEditFieldControlComponent,
  ],
  templateUrl: './bulk-changes-panel.component.html',
})
export class BulkChangesPanelComponent {
  /**
   * Grupos ya resueltos por tipo objetivo + industrias, SIN el grupo `type`
   * (el conductor se pinta aparte, arriba).
   */
  readonly groups = input<readonly BulkEditVisibleGroup[]>([]);
  /** `FormGroup` con un control por campo del contrato. Lo crea la página. */
  readonly form = input.required<FormGroup>();
  /** Opciones de `product_type` ya gateadas por industria. */
  readonly typeOptions = input<readonly BulkEditFieldOption[]>([]);
  /** Catálogo de unidades de medida (`optionsRef: 'uom-*'`). */
  readonly uomOptions = input<readonly SelectorOption[]>([]);
  /** Catálogo de plantillas de consulta (`optionsRef: 'document-templates'`). */
  readonly templateOptions = input<readonly SelectorOption[]>([]);
  /** Cuántos productos hay en el stack, para el aviso de alcance. */
  readonly selectionCount = input<number>(0);
  /**
   * `store:products:admin_delete` resuelto por la página. Sin él la zona
   * peligrosa no se pinta: quien no puede eliminar no debería ni verlo ofrecido.
   */
  readonly canArchive = input<boolean>(false);

  /** Campos que el usuario activó explícitamente. */
  readonly activeFields = model<ReadonlySet<BulkEditableFieldKey>>(
    new Set<BulkEditableFieldKey>(),
  );

  /** El usuario pidió limpiar todos los cambios pendientes. */
  readonly resetRequested = output<void>();
  /**
   * El usuario pidió eliminar la selección. La página abre el modal de
   * confirmación reforzada; este componente no escribe nada.
   */
  readonly archiveRequested = output<void>();

  /** Sin productos seleccionados no hay nada que eliminar. */
  readonly archiveDisabled = computed<boolean>(() => this.selectionCount() === 0);

  readonly typeFieldKey = TYPE_FIELD_KEY;

  /** `app-input-buttons` exige `value: string`, no `string | number`. */
  readonly typeButtonOptions = computed<InputButtonOption[]>(() =>
    this.typeOptions().map((option) => ({
      value: String(option.value),
      label: option.label,
    })),
  );

  /**
   * Configuraciones activadas que además EXISTEN para el tipo objetivo actual.
   * Se cuenta contra los grupos visibles y no contra el `Set` crudo: al cambiar
   * de tipo puede quedar activado un campo que ya no aplica, y anunciar "5
   * configuraciones" cuando solo 3 van a viajar sería mentir. La página aplica
   * la misma intersección al construir el payload.
   */
  readonly activeCount = computed<number>(() => {
    const active = this.activeFields();
    let count = active.has(TYPE_FIELD_KEY) ? 1 : 0;
    for (const group of this.groups()) {
      for (const field of group.fields) {
        if (active.has(field.key)) {
          count += 1;
        }
      }
    }
    return count;
  });

  /**
   * Buscador del catálogo. Vive AQUÍ y no en la página a propósito: es filtrado
   * de presentación y no debe llegar a ninguna parte que construya el payload.
   * Si el filtro tocara los grupos que la página usa para intersecar los campos
   * activados, escribir en un buscador silenciaría configuraciones ya activadas
   * y el `apply` mandaría menos de lo que el usuario ve marcado.
   *
   * Es un `FormControl` y no una señal suelta porque el término se limpia desde
   * dos sitios (la × del propio input y el botón del estado vacío) y
   * `app-inputsearch` no expone la caja como input: sin un control por medio,
   * limpiar desde fuera dejaría el filtro vacío con texto todavía escrito.
   *
   * `[formControl]`, no `formControlName`: este campo NO pertenece al `FormGroup`
   * del contrato de edición, aunque el panel esté dentro de su `[formGroup]`.
   */
  readonly queryControl = new FormControl<string>('', { nonNullable: true });

  /**
   * El valor se lee por `toSignal(valueChanges)` y no por `queryControl.value`:
   * un `computed` que lee `.value` no se recalcula, porque el control no es una
   * señal y el `computed` no tiene de qué depender.
   */
  readonly query = toSignal(this.queryControl.valueChanges, {
    initialValue: '',
  });

  /** Hay un término efectivo (no solo espacios). */
  readonly isFiltering = computed<boolean>(() => normalize(this.query()) !== '');

  /**
   * Catálogo visible tras el buscador. Solo se usa para PINTAR: `activeCount()`
   * sigue contando contra `groups()`, porque el contador anuncia lo que va a
   * viajar y no lo que se está viendo — si contara los filtrados, el número
   * bajaría mientras el usuario teclea y parecería que se pierden cambios.
   *
   * Acertar el nombre del grupo trae el grupo entero (buscar "restaurante" o
   * "precio" es navegar, no cazar un campo suelto); si no, se filtran los campos
   * por etiqueta, descripción y clave, y el grupo desaparece si no queda ninguno.
   */
  readonly filteredGroups = computed<readonly BulkEditVisibleGroup[]>(() => {
    const term = normalize(this.query());
    const groups = this.groups();
    if (!term) {
      return groups;
    }

    const matched: BulkEditVisibleGroup[] = [];
    for (const group of groups) {
      if (matches(term, group.label, group.hint)) {
        matched.push(group);
        continue;
      }
      const fields = group.fields.filter((field) =>
        matches(term, field.label, field.description, field.key),
      );
      if (fields.length > 0) {
        matched.push({ ...group, fields });
      }
    }
    return matched;
  });

  /** Cuántas configuraciones sobreviven al filtro, para el contador del buscador. */
  readonly filteredFieldCount = computed<number>(() =>
    this.filteredGroups().reduce((total, group) => total + group.fields.length, 0),
  );

  clearQuery(): void {
    this.queryControl.setValue('');
  }

  isActive(key: BulkEditableFieldKey): boolean {
    return this.activeFields().has(key);
  }

  /**
   * Un campo con `dependsOn` cuyo campo padre no está activado. Es un aviso, no
   * una restricción: el backend evalúa la dependencia contra el valor efectivo
   * (DTO ?? producto existente), así que activar solo `sale_price` sobre
   * productos que ya están en oferta es perfectamente legítimo.
   */
  dependencyPending(field: BulkEditableField): boolean {
    const dependsOn = field.dependsOn;
    if (!dependsOn) {
      return false;
    }
    return !this.activeFields().has(dependsOn);
  }

  /** Catálogo dinámico que le toca al campo según su `optionsRef`. */
  dynamicOptionsFor(field: BulkEditableField): readonly SelectorOption[] {
    switch (field.optionsRef) {
      case 'uom-purchase':
      case 'uom-stock':
        return this.uomOptions();
      case 'document-templates':
        return this.templateOptions();
      default:
        return [];
    }
  }

  /**
   * Activa/desactiva un campo. Publica SIEMPRE un `Set` nuevo: mutar el
   * existente no cambiaría la referencia y la señal no notificaría a nadie
   * (bug silencioso clásico de zoneless).
   */
  onFieldActiveChange(key: BulkEditableFieldKey, next: boolean): void {
    const current = new Set(this.activeFields());
    if (next) {
      current.add(key);
    } else {
      current.delete(key);
      this.resetControl(key);
    }
    this.activeFields.set(current);
  }

  onTypeActiveChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.onFieldActiveChange(TYPE_FIELD_KEY, Boolean(target?.checked));
  }

  /**
   * Al desactivar un campo se limpia su control: si no se limpiara, reactivarlo
   * más tarde lo reabriría con un valor que el usuario ya había descartado — y
   * ese valor SÍ viajaría al backend.
   *
   * `product_type` es la excepción: sigue conduciendo el catálogo aunque no se
   * vaya a aplicar, así que resetearlo dejaría el panel sin tipo objetivo.
   */
  private resetControl(key: BulkEditableFieldKey): void {
    if (key === TYPE_FIELD_KEY) {
      return;
    }
    const control = this.form().get(key);
    if (!control) {
      return;
    }
    if (control instanceof FormGroup) {
      control.reset({ length: null, width: null, height: null });
      return;
    }
    // Los toggles son `nonNullable` con default `false`; `reset()` los devuelve
    // a ese default y el resto de controles a `null`.
    control.reset();
  }
}
