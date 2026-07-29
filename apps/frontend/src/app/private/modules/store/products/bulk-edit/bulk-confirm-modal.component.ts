/**
 * Modal de confirmación de la edición masiva (QUI-567).
 *
 * ## Consentimiento informado, no un "¿estás seguro?"
 *
 * Un modal que solo pregunte "¿Confirmas?" sobre 100 productos no es
 * consentimiento: el operador no puede saber qué está aceptando. Por eso al
 * abrirse llama a `POST /store/products/bulk-edit/preview` (dry-run que NO
 * escribe) y muestra cuatro cosas antes de habilitar el botón:
 *
 *  1. Cuántos productos se van a editar.
 *  2. El desglose `ok` / `warning` / `error`.
 *  3. Producto por producto, el diff `campo: actual → nuevo`.
 *  4. Los que van a fallar, con el motivo traducido a español.
 *
 * El botón de confirmar queda deshabilitado si NINGÚN producto es aplicable
 * (`ok + warning === 0`): confirmar entonces solo produciría 100 fallos.
 *
 * ## `warning` no significa "no se aplicará"
 *
 * Significa que se aplicará CON una neutralización silenciosa del backend: un
 * flag que la industria de la tienda no soporta se guardará en `false`, o el
 * sanitizer de insumo puro anulará los precios. Se muestra en ámbar y se
 * explica, porque el resultado no es el que el usuario pidió literalmente.
 *
 * ## Por qué el preview vive aquí y no en la página
 *
 * El preview es un artefacto EXCLUSIVO de esta confirmación: si el usuario
 * cierra el modal sin confirmar, el preview no le sirve a nadie más y debe
 * desaparecer. Guardarlo en la página lo dejaría vivo tras cerrar, y con el
 * `<ng-content>` de `app-modal` (que NO se destruye al cerrar) eso significaría
 * reabrir el modal mostrando el diff de una selección anterior. Se resetea de
 * forma explícita en la transición a cerrado.
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
  type SaveRequirement,
} from '../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ERROR_MESSAGES } from '../../../../../core/utils/error-messages';
import {
  PRODUCT_SAVE_ERROR_MAP,
  mapBackendErrorToRequirements,
} from '../utils/product-save-requirements';
import {
  BULK_EDIT_PRODUCT_TYPE_LABELS,
  findBulkEditableField,
} from './bulk-editable-fields.constant';
import type {
  BulkEditItemStatus,
  BulkEditPreviewItem,
  BulkEditPreviewResult,
  BulkEditResult,
  BulkEditableChanges,
  BulkEditableFieldKey,
} from './bulk-edit.interface';
import {
  ProductsBulkEditService,
  type ProductNameResolver,
} from './products-bulk-edit.service';

/** Etapa del flujo del modal. */
export type BulkConfirmStage =
  | 'previewing'
  | 'ready'
  | 'preview-failed'
  | 'applying'
  | 'done';

@Component({
  selector: 'app-bulk-confirm-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, IconComponent, AlertBannerComponent],
  templateUrl: './bulk-confirm-modal.component.html',
})
export class BulkConfirmModalComponent {
  private readonly bulkEditService = inject(ProductsBulkEditService);
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Visibilidad. Two-way con la página. */
  readonly modalOpen = model<boolean>(false);
  /** Ids seleccionados, en el orden del stack. */
  readonly ids = input<number[]>([]);
  /** Cambios activados por el usuario. Solo estos campos viajan al backend. */
  readonly changes = input<BulkEditableChanges>({});
  /** Resuelve nombres cuando un lote cae y el backend no devuelve fichas. */
  readonly resolveName = input<ProductNameResolver | undefined>(undefined);

  /** La edición terminó (con o sin fallos). La página recarga el listado. */
  readonly applied = output<BulkEditResult>();

  readonly stage = signal<BulkConfirmStage>('previewing');
  readonly previewResult = signal<BulkEditPreviewResult | null>(null);
  readonly applyResult = signal<BulkEditResult | null>(null);
  /** Filas del modal de requisitos cuando la petición entera se cae. */
  readonly requestRequirements = signal<SaveRequirement[]>([]);

  /** Progreso del troceado, publicado por el servicio. */
  readonly progress = this.bulkEditService.progress;

  readonly progressPercent = computed<number>(() => {
    const progress = this.progress();
    if (progress.totalIds === 0) {
      return 0;
    }
    return Math.round((progress.doneIds / progress.totalIds) * 100);
  });

  /** Productos que el backend SÍ va a intentar escribir. */
  readonly applicableCount = computed<number>(() => {
    const preview = this.previewResult();
    if (!preview) {
      return 0;
    }
    return preview.ok + preview.warnings;
  });

  readonly canConfirm = computed<boolean>(
    () => this.stage() === 'ready' && this.applicableCount() > 0,
  );

  /** Items ordenados: primero los errores, para que no pasen desapercibidos. */
  readonly previewItems = computed<BulkEditPreviewItem[]>(() => {
    const preview = this.previewResult();
    if (!preview) {
      return [];
    }
    const rank: Record<BulkEditItemStatus, number> = {
      error: 0,
      warning: 1,
      ok: 2,
    };
    return [...preview.items].sort(
      (a, b) => rank[a.status] - rank[b.status],
    );
  });

  readonly failedResults = computed(() =>
    (this.applyResult()?.results ?? []).filter((row) => row.status === 'error'),
  );

  /**
   * Formateador de valores del diff.
   *
   * Es un `computed` que DEVUELVE una función, no un método, y eso es
   * deliberado: leer `currencyFormat.currentCurrency()` aquí dentro ata el
   * formateo a la señal de moneda. Un método normal invocado desde el template
   * no volvería a evaluarse cuando la moneda de la tienda termina de cargar, y
   * el diff se quedaría con el formato de arranque.
   */
  readonly formatValue = computed<(field: string, value: unknown) => string>(
    () => {
      // Dependencia explícita: cualquier cambio de moneda re-crea el formateador.
      this.currencyFormat.currentCurrency();
      return (field: string, value: unknown): string =>
        this.describeValue(field, value);
    },
  );

  constructor() {
    // Al abrirse, dispara el dry-run. Al cerrarse, borra TODO: `app-modal`
    // proyecta su contenido con `<ng-content>` y no lo destruye al cerrar, así
    // que sin este reset el modal reabriría mostrando el diff anterior.
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
    if (!this.canConfirm()) {
      return;
    }
    const ids = this.ids();
    const changes = this.changes();

    this.stage.set('applying');
    this.requestRequirements.set([]);

    this.bulkEditService
      .applyInBatches(ids, changes, this.resolveName())
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
          this.requestRequirements.set(mapBackendErrorToRequirements(err));
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
    return (
      findBulkEditableField(key as BulkEditableFieldKey)?.label ?? key
    );
  }

  /**
   * Motivo traducido de un fallo o una neutralización.
   *
   * Cascada: catálogo curado de productos → catálogo global de `error_code` →
   * mensaje del backend. Nunca se muestra un código crudo como único texto.
   */
  describeFailure(code?: string, message?: string): string {
    if (code && PRODUCT_SAVE_ERROR_MAP[code]) {
      return PRODUCT_SAVE_ERROR_MAP[code].reason;
    }
    if (code && ERROR_MESSAGES[code]) {
      return ERROR_MESSAGES[code];
    }
    return message?.trim() || 'No se pudo determinar el motivo.';
  }

  statusLabel(status: BulkEditItemStatus): string {
    switch (status) {
      case 'ok':
        return 'Se aplicará';
      case 'warning':
        return 'Se aplicará con ajustes';
      default:
        return 'No se aplicará';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private runPreview(): void {
    const ids = this.ids();
    const changes = this.changes();

    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.requestRequirements.set([]);

    this.bulkEditService
      .previewInBatches(ids, changes, this.resolveName())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.previewResult.set(result);
          this.stage.set('ready');
        },
        error: (err: unknown) => {
          this.requestRequirements.set(mapBackendErrorToRequirements(err));
          this.stage.set('preview-failed');
        },
      });
  }

  private reset(): void {
    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.requestRequirements.set([]);
    this.bulkEditService.resetProgress();
  }

  /** Formatea un valor del diff según el tipo de control de su campo. */
  private describeValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    if (typeof value === 'boolean') {
      return value ? 'Sí' : 'No';
    }

    const meta = findBulkEditableField(field as BulkEditableFieldKey);

    if (field === 'product_type') {
      const key = String(
        value,
      ) as keyof typeof BULK_EDIT_PRODUCT_TYPE_LABELS;
      return BULK_EDIT_PRODUCT_TYPE_LABELS[key] ?? String(value);
    }

    if (meta?.control === 'currency') {
      return this.currencyFormat.format(Number(value) || 0);
    }

    if (meta?.options) {
      const match = meta.options.find(
        (option) => String(option.value) === String(value),
      );
      if (match) {
        return match.label;
      }
    }

    if (typeof value === 'object') {
      // `dimensions` es el único objeto del contrato.
      const dims = value as Record<string, unknown>;
      const parts = ['length', 'width', 'height']
        .map((axis) => dims[axis])
        .filter((axis) => axis !== undefined && axis !== null);
      if (parts.length > 0) {
        return `${parts.join(' × ')} cm`;
      }
      return JSON.stringify(value);
    }

    const suffix = meta?.suffix ? ` ${meta.suffix}` : '';
    return `${String(value)}${suffix}`;
  }
}
