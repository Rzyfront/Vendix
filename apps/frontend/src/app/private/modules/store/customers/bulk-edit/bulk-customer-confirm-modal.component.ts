/**
 * Modal de confirmación de la edición masiva de clientes.
 *
 * ## Consentimiento informado, no un «¿estás seguro?»
 *
 * Un modal que solo pregunte «¿Confirmas?» sobre 200 clientes no es
 * consentimiento: el operador no puede saber qué acepta. Al abrirse se llama a
 * `POST /bulk-edit/preview` (dry-run que NO escribe) y se muestran cuatro cosas
 * antes de habilitar el botón:
 *
 *  1. Cuántos clientes se van a editar.
 *  2. El desglose `ok` / `warning` / `error`.
 *  3. Cliente por cliente, el diff `campo: actual → nuevo`.
 *  4. Los que van a fallar, con el motivo.
 *
 * Además, cuando el lote asigna tarifa, `tier_overwrite_count` dice en voz alta
 * cuántos clientes tenían OTRA tarifa que va a ser reemplazada: es la única
 * operación del módulo que destruye información que el operador no ve en el
 * panel (la tarifa previa de cada cliente).
 *
 * ## `warning` no significa «no se aplicará»
 *
 * Significa que se aplicará CON una consecuencia que debe conocer: sobrescribir
 * otra tarifa, o vaciar nombre y apellido al marcar persona jurídica.
 *
 * ## Por qué el preview vive aquí y no en la página
 *
 * El preview es un artefacto EXCLUSIVO de esta confirmación: si el usuario
 * cierra el modal sin confirmar, no le sirve a nadie más y debe desaparecer.
 * `app-modal` proyecta su contenido con `<ng-content>` y no lo destruye al
 * cerrar, así que se resetea de forma explícita al pasar a cerrado; si no,
 * reabrir mostraría el diff de una selección anterior.
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  IconComponent,
  ModalComponent,
  type SelectorOption,
} from '../../../../../shared/components/index';
import { getTaxRegimeLabel } from '../../../../../shared/constants/tax-regime.constants';
import { getFiscalResponsibilityLabel } from '../../../../../shared/constants/fiscal-responsibilities.constants';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  findBulkCustomerField,
  PERSON_TYPE_OPTIONS,
} from './bulk-editable-customer-fields.constant';
import type {
  BulkCustomerItemStatus,
  BulkCustomerPreviewItem,
  BulkCustomerPreviewResult,
  BulkCustomerResult,
  BulkEditableCustomerChanges,
} from './bulk-edit-customers.interface';
import {
  CustomersBulkEditService,
  type CustomerNameResolver,
} from './customers-bulk-edit.service';

/** Etapa del flujo del modal. */
export type BulkCustomerConfirmStage =
  | 'previewing'
  | 'ready'
  | 'preview-failed'
  | 'applying'
  | 'done';

@Component({
  selector: 'app-bulk-customer-confirm-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, IconComponent, AlertBannerComponent],
  templateUrl: './bulk-customer-confirm-modal.component.html',
})
export class BulkCustomerConfirmModalComponent {
  private readonly bulkEditService = inject(CustomersBulkEditService);
  private readonly destroyRef = inject(DestroyRef);

  /** Visibilidad. Two-way con la página. */
  readonly modalOpen = model<boolean>(false);
  /** Ids seleccionados, en el orden del stack. */
  readonly ids = input<number[]>([]);
  /** Cambios activados. Solo estos campos viajan al backend. */
  readonly changes = input<BulkEditableCustomerChanges>({});
  /** Resuelve nombres cuando un lote cae y el backend no devuelve fichas. */
  readonly resolveName = input<CustomerNameResolver | undefined>(undefined);
  /** Tarifas de la tienda (para mostrar nombres en el diff, no ids). */
  readonly priceTiers = input<readonly SelectorOption[]>([]);
  /** Etiquetas del CRM (ídem). */
  readonly crmTags = input<readonly SelectorOption[]>([]);

  readonly applied = output<BulkCustomerResult>();

  readonly stage = signal<BulkCustomerConfirmStage>('previewing');
  readonly previewResult = signal<BulkCustomerPreviewResult | null>(null);
  readonly applyResult = signal<BulkCustomerResult | null>(null);
  readonly requestError = signal<string | null>(null);

  readonly progress = this.bulkEditService.progress;

  readonly progressPercent = computed<number>(() => {
    const progress = this.progress();
    if (progress.totalIds === 0) return 0;
    return Math.round((progress.doneIds / progress.totalIds) * 100);
  });

  /** Clientes que el backend SÍ va a intentar escribir. */
  readonly applicableCount = computed<number>(() => {
    const preview = this.previewResult();
    return preview ? preview.ok + preview.warnings : 0;
  });

  readonly canConfirm = computed<boolean>(
    () => this.stage() === 'ready' && this.applicableCount() > 0,
  );

  /** Items ordenados: primero los errores, para que no pasen desapercibidos. */
  readonly previewItems = computed<BulkCustomerPreviewItem[]>(() => {
    const preview = this.previewResult();
    if (!preview) return [];
    const rank: Record<BulkCustomerItemStatus, number> = {
      error: 0,
      warning: 1,
      ok: 2,
    };
    return [...preview.items].sort((a, b) => rank[a.status] - rank[b.status]);
  });

  readonly failedResults = computed(() =>
    (this.applyResult()?.results ?? []).filter((row) => row.status === 'error'),
  );

  constructor() {
    effect(() => {
      if (!this.modalOpen()) {
        untracked(() => this.reset());
        return;
      }
      untracked(() => this.runPreview());
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Acciones
  // ───────────────────────────────────────────────────────────────────────────

  onRetryPreview(): void {
    this.runPreview();
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

    this.stage.set('applying');
    this.requestError.set(null);

    this.bulkEditService
      .applyInBatches(this.ids(), this.changes(), this.resolveName())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.applyResult.set(result);
          this.stage.set('done');
          this.applied.emit(result);
        },
        error: (err: unknown) => {
          // `applyInBatches` degrada los lotes caídos internamente, así que
          // llegar aquí es excepcional (fallo de composición, no de red).
          this.requestError.set(parseApiError(err).userMessage);
          this.stage.set('done');
        },
      });
  }

  onClose(): void {
    this.modalOpen.set(false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Presentación
  // ───────────────────────────────────────────────────────────────────────────

  /** Etiqueta humana de un campo del contrato, tomada del registro. */
  describeField(key: string): string {
    if (key === 'tags') return 'Etiquetas';
    return findBulkCustomerField(key)?.label ?? key;
  }

  statusLabel(status: BulkCustomerItemStatus): string {
    switch (status) {
      case 'ok':
        return 'Se aplicará';
      case 'warning':
        return 'Se aplicará con avisos';
      default:
        return 'No se aplicará';
    }
  }

  /** Texto de un valor del diff, según el campo al que pertenece. */
  formatValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return field === 'price_tier_id' ? 'Sin tarifa' : '—';
    }
    if (typeof value === 'boolean') {
      return value ? 'Sí' : 'No';
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return field === 'tags' ? 'Ninguna' : 'Ninguna';
      }
      return value
        .map((entry) => this.describeArrayEntry(field, entry))
        .join(', ');
    }
    switch (field) {
      case 'person_type':
        return (
          PERSON_TYPE_OPTIONS.find((option) => option.value === value)?.label ??
          String(value)
        );
      case 'tax_regime':
        return getTaxRegimeLabel(String(value));
      case 'price_tier_id': {
        const tier = this.priceTiers().find(
          (option) => String(option.value) === String(value),
        );
        return tier?.label ?? `Tarifa #${value}`;
      }
      default:
        return String(value);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private runPreview(): void {
    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.requestError.set(null);

    this.bulkEditService
      .previewInBatches(this.ids(), this.changes(), this.resolveName())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.previewResult.set(result);
          this.stage.set('ready');
        },
        error: (err: unknown) => {
          this.requestError.set(parseApiError(err).userMessage);
          this.stage.set('preview-failed');
        },
      });
  }

  private reset(): void {
    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.requestError.set(null);
    this.bulkEditService.resetProgress();
  }

  private describeArrayEntry(field: string, entry: unknown): string {
    if (field === 'tags') {
      const tag = this.crmTags().find(
        (option) => String(option.value) === String(entry),
      );
      return tag?.label ?? `Etiqueta #${entry}`;
    }
    if (field === 'fiscal_responsibilities') {
      return getFiscalResponsibilityLabel(String(entry));
    }
    return String(entry);
  }
}
