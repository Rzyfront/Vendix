/**
 * Modal de confirmación del ARCHIVADO masivo (QUI-567 paso 13).
 *
 * ## Por qué es un modal aparte y no una variante de `bulk-confirm-modal`
 *
 * Comparte la forma (preview → desglose → confirmar → informe) pero no el
 * contenido ni la severidad:
 *
 * | | `bulk-confirm-modal` | este |
 * | --- | --- | --- |
 * | endpoint | `/bulk-edit/preview` + `/bulk-edit` | `/bulk-edit/archive/preview` + `/bulk-edit/archive` |
 * | permiso | `store:products:bulk_update` | `store:products:admin_delete` |
 * | cuerpo | diff `campo: actual → nuevo` | lista de productos + motivos |
 * | reversible | sí (basta volver a editar) | **NO** |
 * | gesto | botón | casilla + botón |
 *
 * Meterlo dentro del otro modal habría obligado a ramificar cada bloque de su
 * plantilla por un flag `mode`, sobre un flujo ya verificado y de menor
 * severidad. Se entrega como hermano.
 *
 * ## Sin diffs: no hay campos
 *
 * El preview de archivado NO devuelve `changes[]` (`BulkArchivePreviewItemDto` no
 * lo declara). No hay nada que diffear: no se cambia un campo, se elimina el
 * producto. Lo que el modal muestra es CUÁNTOS, CUÁLES, y por cada `error` /
 * `warning` su MOTIVO.
 *
 * ## Confirmación reforzada — requisito duro, no adorno
 *
 * El archivado es IRREVERSIBLE DESDE LA APLICACIÓN. Se verificó que la API no
 * expone ninguna ruta que saque un producto de `archived`: `update()` y
 * `deactivate()` filtran `state != archived`
 * (`apps/backend/src/domains/store/products/products.service.ts:1903-1907` y
 * `:2761-2765`) y no existe `activate` / `restore`. Revertir exige acceso directo
 * a la base de datos.
 *
 * De ahí las dos condiciones del botón de confirmar, ambas necesarias:
 *
 *  1. **Hay algo archivable** (`ok + warning > 0`). Si no, confirmar solo
 *     produciría fallos.
 *  2. **La casilla está marcada.** Un botón se pulsa por inercia; marcar una
 *     casilla que dice "no se puede deshacer" es un gesto deliberado. La casilla
 *     se desmarca sola al cerrar el modal, así que no queda "armada" para la
 *     próxima vez.
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
import type {
  BulkArchivePreviewItem,
  BulkArchivePreviewResult,
  BulkArchiveResult,
  BulkEditItemStatus,
} from './bulk-edit.interface';
import {
  ProductsBulkEditService,
  type ProductNameResolver,
} from './products-bulk-edit.service';

/** Etapa del flujo del modal. */
export type BulkArchiveStage =
  | 'previewing'
  | 'ready'
  | 'preview-failed'
  | 'archiving'
  | 'done';

@Component({
  selector: 'app-bulk-archive-confirm-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    AlertBannerComponent,
  ],
  templateUrl: './bulk-archive-confirm-modal.component.html',
})
export class BulkArchiveConfirmModalComponent {
  private readonly bulkEditService = inject(ProductsBulkEditService);
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Visibilidad. Two-way con la página. */
  readonly modalOpen = model<boolean>(false);
  /** Ids seleccionados, en el orden del stack. */
  readonly ids = input<number[]>([]);
  /** Resuelve nombres cuando un lote cae y el backend no devuelve fichas. */
  readonly resolveName = input<ProductNameResolver | undefined>(undefined);

  /** El archivado terminó (con o sin fallos). La página limpia la selección. */
  readonly archived = output<BulkArchiveResult>();

  readonly stage = signal<BulkArchiveStage>('previewing');
  readonly previewResult = signal<BulkArchivePreviewResult | null>(null);
  readonly archiveResult = signal<BulkArchiveResult | null>(null);
  /** Filas de requisitos cuando la petición entera se cae. */
  readonly requestRequirements = signal<SaveRequirement[]>([]);

  /**
   * El gesto deliberado. Arranca en `false` en cada apertura y sin él el botón de
   * confirmar no se habilita jamás.
   */
  readonly acknowledged = signal<boolean>(false);

  /** Progreso del troceado, publicado por el servicio. */
  readonly progress = this.bulkEditService.progress;

  readonly progressPercent = computed<number>(() => {
    const progress = this.progress();
    if (progress.totalIds === 0) {
      return 0;
    }
    return Math.round((progress.doneIds / progress.totalIds) * 100);
  });

  /**
   * Productos que el backend SÍ va a archivar. Los `warning` cuentan: el aviso no
   * bloquea el archivado, solo informa de una consecuencia (insumo de receta
   * activa, promoción vigente).
   */
  readonly archivableCount = computed<number>(() => {
    const preview = this.previewResult();
    if (!preview) {
      return 0;
    }
    return preview.ok + preview.warnings;
  });

  readonly blockedCount = computed<number>(
    () => this.previewResult()?.errors ?? 0,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CP-PURCHASE-TRANSPARENCY D.9 — el castigo de inventario, agregado
  // ───────────────────────────────────────────────────────────────────────────
  //
  // Sólo cuentan las filas ARCHIVABLES. Las `error` traen sus cifras igual (el
  // backend las manda en todas para que la interfaz no distinga formas), pero
  // sumar el impacto de un producto que no se va a archivar inflaría la cifra
  // que el operador está aprobando: diría que va a destruir más de lo que
  // realmente va a destruir, y la confirmación dejaría de significar lo que
  // dice.

  private readonly archivableItems = computed<BulkArchivePreviewItem[]>(() =>
    (this.previewResult()?.items ?? []).filter((item) => item.status !== 'error'),
  );

  readonly unitsToWriteOff = computed<number>(() =>
    this.archivableItems().reduce((sum, item) => sum + (item.on_hand_units ?? 0), 0),
  );

  readonly valueToWriteOff = computed<number>(() =>
    this.archivableItems().reduce(
      (sum, item) => sum + (item.value_to_write_off ?? 0),
      0,
    ),
  );

  /**
   * Unidades sin costo conocido. NO son unidades gratis: son unidades cuyo
   * costo el sistema no sabe. Se destruyen igual y no entran en el valor, así
   * que sin nombrarlas la cifra de arriba se lee como «casi no vale nada».
   */
  readonly zeroCostUnits = computed<number>(() =>
    this.archivableItems().reduce(
      (sum, item) => sum + (item.zero_cost_units ?? 0),
      0,
    ),
  );

  readonly knownCostUnits = computed<number>(() =>
    Math.max(0, this.unitsToWriteOff() - this.zeroCostUnits()),
  );

  readonly hasUnknownCost = computed<boolean>(() => this.zeroCostUnits() > 0);

  readonly allUnitsUnknownCost = computed<boolean>(
    () =>
      this.unitsToWriteOff() > 0 &&
      this.zeroCostUnits() >= this.unitsToWriteOff(),
  );

  readonly willWriteOffStock = computed<boolean>(() => this.unitsToWriteOff() > 0);

  /**
   * Filas bloqueadas por existencias fuera del alcance de la tienda. Se cuentan
   * aparte de los bloqueos genéricos porque su remedio es distinto y ocurre en
   * otro módulo: transferir o ajustar desde Inventario.
   */
  readonly outOfScopeItems = computed<BulkArchivePreviewItem[]>(() =>
    (this.previewResult()?.items ?? []).filter(
      (item) => (item.out_of_scope_units ?? 0) > 0,
    ),
  );

  readonly outOfScopeUnits = computed<number>(() =>
    this.outOfScopeItems().reduce(
      (sum, item) => sum + (item.out_of_scope_units ?? 0),
      0,
    ),
  );

  /**
   * Formateador de dinero. `computed` que devuelve una función para atar el
   * formato a la señal de moneda: un método suelto no se re-evaluaría cuando la
   * moneda de la tienda termina de cargar y las cifras quedarían con el formato
   * de arranque.
   */
  readonly money = computed<(value: number) => string>(() => {
    this.currencyFormat.currentCurrency();
    return (value: number): string => this.currencyFormat.format(value || 0);
  });

  /**
   * Las DOS condiciones del gesto deliberado. Si falta cualquiera, no se archiva.
   */
  readonly canConfirm = computed<boolean>(
    () =>
      this.stage() === 'ready' &&
      this.archivableCount() > 0 &&
      this.acknowledged(),
  );

  /**
   * CP-PURCHASE-TRANSPARENCY (T2/D.4) — POR QUÉ el botón de confirmar está
   * apagado.
   *
   * El botón se pintaba deshabilitado sin decir qué faltaba: la interfaz
   * negando una acción sin dar el motivo, que es exactamente el antipatrón
   * que este plan persigue. El aviso de «no se puede eliminar ninguno» ya
   * existía dentro del cuerpo, pero el cuerpo es scrollable (la lista llega a
   * `max-h-[40vh]`) y el botón vive en el pie: cuando el operador mira el
   * botón, el motivo puede estar fuera de la pantalla. Aquí va JUNTO al
   * botón, que es donde se hace la pregunta.
   *
   * Cadena vacía = el botón está habilitado y no hay nada que explicar.
   */
  readonly confirmBlockedReason = computed<string>(() => {
    if (this.stage() !== 'ready') return '';
    if (this.archivableCount() === 0) {
      return 'No hay ningún producto que se pueda eliminar en esta selección.';
    }
    if (!this.acknowledged()) {
      return 'Marca la casilla de arriba para habilitar la eliminación.';
    }
    return '';
  });

  /** Items ordenados: primero los bloqueados, para que no pasen desapercibidos. */
  readonly previewItems = computed<BulkArchivePreviewItem[]>(() => {
    const preview = this.previewResult();
    if (!preview) {
      return [];
    }
    const rank: Record<BulkEditItemStatus, number> = {
      error: 0,
      warning: 1,
      ok: 2,
    };
    return [...preview.items].sort((a, b) => rank[a.status] - rank[b.status]);
  });

  readonly failedResults = computed(() =>
    (this.archiveResult()?.results ?? []).filter(
      (row) => row.status === 'error',
    ),
  );

  constructor() {
    // Al abrirse, dispara el dry-run. Al cerrarse, borra TODO — incluida la
    // casilla. `app-modal` proyecta su contenido con `<ng-content>` y NO lo
    // destruye al cerrar, así que sin este reset el modal reabriría con el
    // preview de la selección anterior y, peor, con la casilla ya marcada: el
    // gesto deliberado se habría convertido en un botón de un solo clic.
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

  onAcknowledgeChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.acknowledged.set(Boolean(target?.checked));
  }

  onConfirm(): void {
    // Re-comprobación en el handler y no solo en el `[disabled]` del botón: un
    // atributo deshabilitado es afordancia, no control de acceso.
    if (!this.canConfirm()) {
      return;
    }
    const ids = this.ids();

    this.stage.set('archiving');
    this.requestRequirements.set([]);

    this.bulkEditService
      // CP-PURCHASE-TRANSPARENCY D.6/D.9 — la confirmación del castigo viaja
      // SÓLO cuando el preview declaró que hay existencias que castigar. Si no
      // las hay, mandar `true` declararía una decisión que el operador nunca
      // tuvo que tomar y que la casilla que marcó no describía.
      .archiveInBatches(ids, this.resolveName(), this.willWriteOffStock())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.archiveResult.set(result);
          this.stage.set('done');
          this.archived.emit(result);
        },
        error: (err: unknown) => {
          // `archiveInBatches` degrada los lotes caídos internamente, así que
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

  /**
   * Motivo de un bloqueo o de un aviso.
   *
   * Cascada INVERSA a la de `bulk-confirm-modal.describeFailure()`, y es
   * deliberado: aquí el `message` del backend va PRIMERO.
   *
   * Motivo: el preview de archivado redacta mensajes específicos de ESTA acción
   * ("El producto está en pedidos abiertos. Finaliza o cancela esos pedidos antes
   * de archivarlo.") reutilizando códigos genéricos, porque el contrato prohíbe
   * inventar códigos nuevos. `PROD_VALIDATE_001` en `PRODUCT_SAVE_ERROR_MAP`
   * habla de variantes y manejo de inventario — cierto para una edición, falso
   * para un archivado. Preferir el catálogo curado mostraría un motivo
   * equivocado. Los catálogos siguen como respaldo para los códigos que llegan
   * sin mensaje (p. ej. los degradados de un lote caído).
   */
  describeReason(code?: string, message?: string): string {
    const backendMessage = message?.trim();
    if (backendMessage) {
      return backendMessage;
    }
    if (code && PRODUCT_SAVE_ERROR_MAP[code]) {
      return PRODUCT_SAVE_ERROR_MAP[code].reason;
    }
    if (code && ERROR_MESSAGES[code]) {
      return ERROR_MESSAGES[code];
    }
    return 'No se pudo determinar el motivo.';
  }

  statusLabel(status: BulkEditItemStatus): string {
    switch (status) {
      case 'ok':
        return 'Se archivará';
      case 'warning':
        return 'Se archivará con avisos';
      default:
        return 'No se archivará';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private runPreview(): void {
    const ids = this.ids();

    this.stage.set('previewing');
    this.previewResult.set(null);
    this.archiveResult.set(null);
    this.requestRequirements.set([]);
    // Reintentar el preview también re-arma el gesto: el impacto que el usuario
    // aceptó pudo haber cambiado entre el primer cálculo y este.
    this.acknowledged.set(false);

    this.bulkEditService
      .previewArchiveInBatches(ids, this.resolveName())
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
    this.archiveResult.set(null);
    this.requestRequirements.set([]);
    this.acknowledged.set(false);
    this.bulkEditService.resetProgress();
  }
}
