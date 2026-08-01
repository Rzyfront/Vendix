/**
 * Pre-confirmación de una operación masiva de órdenes (QUI-599).
 *
 * Calque de `bulk-confirm-modal` de productos (QUI-567): al abrirse llama al
 * dry-run del backend, muestra el impacto orden por orden, y solo entonces
 * habilita el botón que escribe. Reemplaza el `DialogService.confirm` genérico
 * que había antes, que preguntaba "¿seguro?" sin poder decir sobre cuántas
 * órdenes iba a actuar realmente.
 *
 * ## Por qué el preview vive aquí y no en la página
 *
 * El dry-run es un artefacto EXCLUSIVO de esta confirmación: si el operador
 * cierra sin confirmar, a nadie más le sirve. Dejarlo en la página obligaría a
 * limpiarlo desde fuera y a que la página conociera estados (`previewing`,
 * `preview-failed`) que solo el modal usa.
 *
 * ## El reset al cerrar no es opcional
 *
 * `app-modal` proyecta su contenido con `<ng-content>` y NO lo destruye al
 * cerrar. Sin el reset del `effect`, reabrir el modal mostraría el dry-run de
 * la selección anterior — que es peor que no mostrar nada, porque parece
 * fresco.
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
} from '../../../../../shared/components/index';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { OrdersBulkService } from './orders-bulk.service';
import type {
  BulkOrderPreviewItem,
  BulkOrderPreviewStatus,
  BulkOrderTransitionTarget,
  BulkOrdersPreviewResult,
  BulkOrdersResult,
} from './orders-bulk.interface';

/**
 * Qué operación se está confirmando. Unión discriminada en vez de un id suelto
 * + campos opcionales: así el compilador garantiza que `assign-route` siempre
 * traiga `route_id` y que `transition` siempre traiga `targetState`, y el modal
 * no tiene que defenderse de una combinación imposible en runtime.
 */
export type BulkOrdersConfirmRequest =
  | {
      kind: 'transition';
      targetState: BulkOrderTransitionTarget;
      /** Título del modal. Lo redacta la página, que sabe qué botón se pulsó. */
      title: string;
      subtitle: string;
      /** Verbo del botón que escribe ("Finalizar", "Cancelar"…). */
      confirmVerb: string;
      /** Pinta el botón de confirmar en rojo y añade la advertencia dura. */
      danger: boolean;
    }
  | {
      kind: 'assign-route';
      route_id: number;
      title: string;
      subtitle: string;
      confirmVerb: string;
      danger: boolean;
    };

/** Etapa del flujo del modal. Espejo conceptual de `BulkConfirmStage`. */
export type OrdersBulkConfirmStage =
  | 'previewing'
  | 'ready'
  | 'preview-failed'
  | 'applying'
  | 'done';

/** Orden en que se listan las filas: primero lo que exige atención. */
const STATUS_WEIGHT: Record<BulkOrderPreviewStatus, number> = {
  error: 0,
  warning: 1,
  skipped: 2,
  ok: 3,
};

@Component({
  selector: 'app-orders-bulk-confirm-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    AlertBannerComponent,
  ],
  templateUrl: './orders-bulk-confirm-modal.component.html',
})
export class OrdersBulkConfirmModalComponent {
  private readonly bulkService = inject(OrdersBulkService);
  private readonly destroyRef = inject(DestroyRef);

  readonly modalOpen = model<boolean>(false);

  readonly ids = input<number[]>([]);

  /**
   * `null` mientras no haya operación elegida. El `effect` no dispara el
   * preview sin request: abrir el modal sin saber qué se va a hacer produciría
   * una petición sin destino.
   */
  readonly request = input<BulkOrdersConfirmRequest | null>(null);

  readonly applied = output<BulkOrdersResult>();

  readonly stage = signal<OrdersBulkConfirmStage>('previewing');
  readonly previewResult = signal<BulkOrdersPreviewResult | null>(null);
  readonly applyResult = signal<BulkOrdersResult | null>(null);
  readonly failureMessage = signal<string>('');

  readonly progress = this.bulkService.progress;

  readonly progressPercent = computed<number>(() => {
    const p = this.progress();
    if (p.totalIds === 0) return 0;
    return Math.round((p.doneIds / p.totalIds) * 100);
  });

  /**
   * Lo que realmente se va a escribir: `ok` + `warning`. Los `skipped` NO
   * cuentan — la orden ya está en el estado destino y el backend hace no-op, así
   * que sumarlos prometería un efecto que no ocurre.
   */
  readonly applicableCount = computed<number>(() => {
    const preview = this.previewResult();
    if (!preview) return 0;
    return preview.ok + preview.warnings;
  });

  readonly canConfirm = computed<boolean>(
    () => this.stage() === 'ready' && this.applicableCount() > 0,
  );

  /** Filas ordenadas: errores primero, luego forzadas, omitidas y por último ok. */
  readonly previewItems = computed<BulkOrderPreviewItem[]>(() => {
    const preview = this.previewResult();
    if (!preview) return [];
    return [...preview.items].sort(
      (a, b) =>
        STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status] ||
        a.order_number.localeCompare(b.order_number),
    );
  });

  readonly failedResults = computed(() =>
    (this.applyResult()?.results ?? []).filter((r) => r.status === 'error'),
  );

  constructor() {
    effect(() => {
      const open = this.modalOpen();
      if (!open) {
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
    const request = this.request();
    if (!request) return;

    this.stage.set('applying');
    this.failureMessage.set('');

    const ids = this.ids();
    const write$ =
      request.kind === 'transition'
        ? this.bulkService.transitionInBatches({
            ids,
            targetState: request.targetState,
          })
        : this.bulkService.assignRouteInBatches({
            ids,
            route_id: request.route_id,
          });

    write$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.applyResult.set(result);
        this.stage.set('done');
        this.applied.emit(result);
      },
      error: (err: unknown) => {
        // `*InBatches` degrada los lotes caídos internamente, así que llegar
        // aquí es excepcional (fallo de composición, no de red).
        this.failureMessage.set(extractApiErrorMessage(err));
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

  statusLabel(status: BulkOrderPreviewStatus): string {
    switch (status) {
      case 'ok':
        return 'Se aplicará';
      case 'warning':
        return 'Se forzará';
      case 'skipped':
        return 'Se omite';
      default:
        return 'No se puede';
    }
  }

  statusIcon(status: BulkOrderPreviewStatus): string {
    switch (status) {
      case 'ok':
        return 'circle-check';
      case 'warning':
        return 'alert-triangle';
      case 'skipped':
        return 'minus-circle';
      default:
        return 'circle-x';
    }
  }

  /** El backend ya redacta el motivo completo; aquí solo se cubre el hueco. */
  describeReason(item: BulkOrderPreviewItem): string {
    return item.message?.trim() || 'Sin motivo reportado por el servidor.';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internos
  // ───────────────────────────────────────────────────────────────────────────

  private runPreview(): void {
    const request = this.request();
    const ids = this.ids();
    if (!request || ids.length === 0) return;

    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.failureMessage.set('');

    const preview$ =
      request.kind === 'transition'
        ? this.bulkService.previewTransitionInBatches({
            ids,
            targetState: request.targetState,
          })
        : this.bulkService.previewAssignRouteInBatches({
            ids,
            route_id: request.route_id,
          });

    preview$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.previewResult.set(result);
        this.stage.set('ready');
      },
      error: (err: unknown) => {
        this.failureMessage.set(extractApiErrorMessage(err));
        this.stage.set('preview-failed');
      },
    });
  }

  private reset(): void {
    this.stage.set('previewing');
    this.previewResult.set(null);
    this.applyResult.set(null);
    this.failureMessage.set('');
    this.bulkService.resetProgress();
  }
}
