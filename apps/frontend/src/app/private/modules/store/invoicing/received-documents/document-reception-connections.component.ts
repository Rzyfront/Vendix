import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, switchMap, take, takeUntil, timer } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { OrganizationStoresService } from '../../../organization/stores/services/organization-stores.service';
import type { StoreListItem } from '../../../organization/stores/interfaces/store.interface';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import { environment } from '../../../../../../environments/environment';
import type { ReceivedDocumentsScope } from './received-documents.interface';
import type { CancelDocumentReceptionRunInput, CreateDocumentReceptionConnectionInput, DocumentReceptionConnection, DocumentReceptionConnectionType, DocumentReceptionRun, RequestDocumentReceptionSyncInput, UpdateDocumentReceptionConnectionInput } from './document-reception-connections.interface';
import { DocumentReceptionConnectionsService } from './document-reception-connections.service';

const STORE_PAGE_SIZE = 200;
const CONNECTION_PAGE_SIZE = 25;
const HTTPS_ENDPOINT = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/;
const CONNECTION_TYPES: DocumentReceptionConnectionType[] = ['api_poll', 'webhook'];

type ConnectionForm = FormGroup<{
  name: FormControl<string>;
  connection_type: FormControl<DocumentReceptionConnectionType>;
  enabled: FormControl<boolean>;
  endpoint: FormControl<string>;
  secret: FormControl<string>;
  poll_interval_minutes: FormControl<number | null>;
}>;

@Component({
  selector: 'app-document-reception-connections', standalone: true,
  imports: [ModalComponent, ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-reception-connections.component.html',
  styles: [`.field{display:flex;flex-direction:column;gap:.375rem;color:var(--color-text-primary);font-size:.875rem;font-weight:500}.field input,.field select,.field textarea{min-height:2.75rem;width:100%;border:1px solid var(--color-border);border-radius:.5rem;background:var(--color-background);padding:.5rem .75rem;color:var(--color-text-primary);font-size:.875rem;font-weight:400}.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--color-primary);outline-offset:1px}`],
})
export class DocumentReceptionConnectionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly storesApi = inject(OrganizationStoresService);
  private readonly api = inject(DocumentReceptionConnectionsService);
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly selectedStoreId = input<number | null>(null);
  readonly isOpen = model(false);
  readonly connectionTypes = CONNECTION_TYPES;
  readonly permission = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:connections:configure`));
  readonly canSync = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:connections:sync`));
  readonly syncCompleted = output<void>();
  readonly form: ConnectionForm = this.buildForm();
  readonly stores = signal<StoreListItem[]>([]);
  readonly storePage = signal(1);
  readonly storeTotal = signal(0);
  readonly selectedOperationalStoreId = signal<number | null>(null);
  readonly storeLoading = signal(false);
  readonly storeError = signal<string | null>(null);
  readonly list = signal<DocumentReceptionConnection[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly selectedId = signal<number | null>(null);
  readonly detail = signal<DocumentReceptionConnection | null>(null);
  readonly runs = signal<DocumentReceptionRun[]>([]);
  readonly runsTotal = signal(0);
  readonly loading = signal(false);
  readonly loadingDetail = signal(false);
  readonly loadingRuns = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly runsError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly submitAttempted = signal(false);
  readonly formMode = signal<'create' | 'edit' | null>(null);
  readonly actionBusy = signal(false);
  readonly actionMessage = signal<string | null>(null);
  readonly actionWarning = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly pollingRunId = signal<number | null>(null);
  readonly cancelingRunId = signal<number | null>(null);
  readonly cancelReason = signal('');
  readonly cancelBusy = signal(false);
  readonly scopeReady = computed(() => this.scope() === 'store' || this.hasOperationalStore());
  readonly canClose = (): boolean => !this.saving();
  readonly listPages = computed(() => Math.max(1, Math.ceil(this.total() / CONNECTION_PAGE_SIZE)));
  readonly storePages = computed(() => Math.max(1, Math.ceil(this.storeTotal() / STORE_PAGE_SIZE)));
  readonly runPages = computed(() => Math.max(1, Math.ceil(this.runsTotal() / CONNECTION_PAGE_SIZE)));
  private epoch = 0;
  private lastContextKey = '';
  private storesRequest?: Subscription;
  private listRequest?: Subscription;
  private detailRequest?: Subscription;
  private runsRequest?: Subscription;
  private saveRequest?: Subscription;
  private actionRequest?: Subscription;
  private cancelRequest?: Subscription;
  private pollRequest?: Subscription;

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const scope = this.scope();
      const hostStoreId = this.selectedStoreId();
      const allowed = this.permission();
      const key = `${open}:${scope}:${hostStoreId ?? ''}:${allowed}`;
      if (key === this.lastContextKey) return;
      this.lastContextKey = key;
      untracked(() => {
        this.resetSession();
        if (!open || !allowed) {
          if (open && !allowed) this.isOpen.set(false);
          return;
        }
        if (scope === 'organization') this.loadStores(1, hostStoreId);
        else this.loadConnections(1);
      });
    });
    this.form.controls.connection_type.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((type) => this.applyTypeValidators(type));
    this.destroyRef.onDestroy(() => this.resetSession());
  }

  get canEdit(): boolean { return this.formMode() !== null && this.scopeReady() && !this.loadingDetail() && !this.saving() && !this.conflict(); }
  get editing(): boolean { return this.formMode() === 'edit'; }
  get syncHasUnsavedChanges(): boolean { return this.formMode() === 'create' || (this.formMode() === 'edit' && this.form.dirty); }
  get syncActionDisabled(): boolean {
    return !this.canSync() || !this.scopeReady() || this.actionBusy() || this.cancelBusy() || this.pollingRunId() !== null || this.saving() || this.loadingDetail() || this.syncHasUnsavedChanges;
  }

  openCreate(): void {
    if (!this.permission() || !this.scopeReady()) return;
    this.closeEditor();
    this.formMode.set('create');
    this.form.enable({ emitEvent: false });
    this.form.reset({ name: '', connection_type: 'api_poll', enabled: false, endpoint: '', secret: '', poll_interval_minutes: 15 });
    this.form.controls.secret.setValidators([Validators.required, Validators.minLength(1), Validators.maxLength(4096)]);
    this.applyTypeValidators('api_poll');
    this.submitAttempted.set(false);
  }

  openEdit(row: DocumentReceptionConnection): void {
    if (!this.permission() || !this.scopeReady()) return;
    this.closeEditor();
    this.formMode.set('edit');
    this.selectedId.set(row.id);
    this.loadDetail(row.id);
  }

  selectConnection(row: DocumentReceptionConnection): void { this.openEdit(row); }

  loadStores(page: number, hostStoreId?: number | null): void {
    if (this.scope() !== 'organization') return;
    this.cancelStoreRequest();
    const epoch = this.epoch;
    this.storeLoading.set(true); this.storeError.set(null);
    this.storesRequest = this.storesApi.getStores({ page, limit: STORE_PAGE_SIZE }).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (epoch === this.epoch) this.storeLoading.set(false); }),
    ).subscribe({
      next: (response) => {
        if (epoch !== this.epoch) return;
        const rows = (response?.data ?? []) as unknown as StoreListItem[];
        const active = rows.filter((store) => store?.is_active !== false && Number.isSafeInteger(store?.id) && store.id > 0);
        this.storePage.set(response?.meta?.page ?? page);
        this.storeTotal.set(response?.meta?.total ?? active.length);
        this.stores.update((existing) => {
          const byId = new Map<number, StoreListItem>();
          for (const store of existing) byId.set(store.id, store);
          for (const store of active) byId.set(store.id, store);
          return [...byId.values()];
        });
        if (hostStoreId && active.some((store) => store.id === hostStoreId)) {
          this.selectOperationalStore(hostStoreId);
        } else if (this.selectedOperationalStoreId() && !this.stores().some((store) => store.id === this.selectedOperationalStoreId() && store.is_active !== false)) {
          this.selectedOperationalStoreId.set(null);
        }
      },
      error: (err: unknown) => { if (epoch === this.epoch) this.storeError.set(this.describeFailure(err, 'No se pudieron cargar las tiendas de la organización.')); },
    });
  }

  changeStorePage(page: number): void {
    if (page < 1 || page > this.storePages() || this.storeLoading()) return;
    this.storePage.set(page);
    this.loadStores(page);
  }

  onOperationalStoreChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || !this.stores().some((store) => store.id === id && store.is_active !== false)) {
      this.selectOperationalStore(null);
      return;
    }
    this.selectOperationalStore(id);
  }

  selectOperationalStore(id: number | null): void {
    if (id === this.selectedOperationalStoreId()) return;
    this.cancelContextRequests();
    this.epoch++;
    this.storeLoading.set(false);
    this.selectedOperationalStoreId.set(id);
    this.clearConnectionState();
    if (id !== null && this.scope() === 'organization') this.loadConnections(1);
  }

  changeListPage(page: number): void {
    if (page < 1 || page > this.listPages() || this.loading()) return;
    this.loadConnections(page);
  }

  changeRunPage(page: number): void {
    if (page < 1 || page > this.runPages() || this.loadingRuns() || !this.selectedId()) return;
    this.loadRuns(this.selectedId()!, page);
  }

  private pollRun(scope: ReceivedDocumentsScope, connectionId: number, runId: number, storeId: number | undefined, epoch: number, page: number): void {
    this.stopActionPolling();
    this.pollingRunId.set(runId);
    this.pollRequest = timer(3000, 3000).pipe(
      take(20),
      switchMap(() => this.api.listRuns(scope, connectionId, page, storeId)),
      takeUntil(timer(60_000)),
    ).subscribe({
      next: (response) => {
        if (epoch !== this.epoch || this.selectedId() !== connectionId || this.pollingRunId() !== runId) return;
        if (!response?.success || !Array.isArray(response.data)) {
          this.stopActionPolling();
          this.actionError.set('No se pudo consultar el resultado; actualiza el historial para verificarlo.');
          return;
        }
        this.runs.set(response.data);
        this.runsTotal.set(response.meta?.total ?? response.data.length);
        this.runPage.set(response.meta?.page ?? page);
        const selectedRun = response.data.find((run) => run.id === runId);
        if (!selectedRun || !this.isTerminal(selectedRun.status)) return;

        this.stopActionPolling();
        this.actionMessage.set(null);
        this.actionWarning.set(null);
        this.actionError.set(null);
        if (selectedRun.status === 'completed') {
          this.actionMessage.set(`La ejecución ${runId} terminó correctamente.`);
          this.syncCompleted.emit();
        } else if (selectedRun.status === 'failed' || selectedRun.status === 'partial') {
          this.actionError.set(`La ejecución ${runId} terminó con estado ${this.safeStatus(selectedRun.status)}. Revisa sus códigos y cantidades en el historial.`);
        } else {
          this.actionWarning.set(`La ejecución ${runId} terminó con estado ${this.safeStatus(selectedRun.status)}.`);
        }
      },
      error: (error: unknown) => {
        if (epoch !== this.epoch || this.pollingRunId() !== runId) return;
        this.stopActionPolling();
        this.actionError.set(this.describeFailure(error, 'No se pudo consultar el resultado; actualiza el historial para verificarlo.'));
      },
      complete: () => {
        if (epoch === this.epoch && this.selectedId() === connectionId && this.pollingRunId() === runId) {
          this.stopActionPolling();
          this.actionWarning.set(`La ejecución ${runId} sigue en curso. Puedes consultar el historial más tarde.`);
        }
      },
    });
  }

  private stopActionPolling(): void {
    this.pollRequest?.unsubscribe();
    this.pollRequest = undefined;
    this.pollingRunId.set(null);
  }

  private isTerminal(status: string): boolean { return ['completed', 'failed', 'partial', 'cancelled'].includes(status); }

  loadConnections(page: number): void {
    if (!this.scopeReady() || !this.permission()) return;
    this.cancelListRequest();
    const epoch = this.epoch;
    this.loading.set(true); this.loadError.set(null);
    this.listRequest = this.api.list(this.scope(), page, this.apiStoreId()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { if (epoch === this.epoch) this.loading.set(false); }),
    ).subscribe({
      next: (response) => {
        if (epoch !== this.epoch) return;
        if (!response?.success || !Array.isArray(response.data)) { this.loadError.set('La respuesta de conexiones no tiene el formato esperado.'); return; }
        this.list.set(response.data); this.total.set(response.meta?.total ?? response.data.length); this.page.set(response.meta?.page ?? page);
      },
      error: (err: unknown) => { if (epoch === this.epoch) this.loadError.set(this.describeFailure(err, 'No se pudieron cargar las conexiones.')); },
    });
  }

  loadDetail(id: number): void {
    if (!this.scopeReady() || !this.permission()) return;
    this.detailRequest?.unsubscribe(); this.runsRequest?.unsubscribe();
    this.detail.set(null); this.runs.set([]); this.runsTotal.set(0); this.loadingDetail.set(true); this.loadingRuns.set(true);
    if (!this.conflict()) this.saveError.set(null);
    this.runsError.set(null); this.savedMessage.set(null);
    const epoch = this.epoch;
    this.detailRequest = this.api.getOne(this.scope(), id, this.apiStoreId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch && this.selectedId() === id) this.loadingDetail.set(false); })).subscribe({
      next: (response) => {
        if (epoch !== this.epoch || this.selectedId() !== id) return;
        if (!response?.success || !response.data) { this.loadError.set('No se pudo obtener el detalle de la conexión.'); return; }
        this.detail.set(response.data); this.patchDetail(response.data);
        this.conflict.set(false); this.saveError.set(null);
      },
      error: (err: unknown) => { if (epoch === this.epoch && this.selectedId() === id) this.saveError.set(this.describeFailure(err, 'No se pudo abrir el detalle de la conexión.')); },
    });
    this.loadRuns(id, 1);
  }

  loadRuns(id: number, page: number): void {
    if (!this.scopeReady() || !this.permission()) return;
    this.runsRequest?.unsubscribe();
    const epoch = this.epoch;
    this.loadingRuns.set(true); this.runsError.set(null);
    this.runsRequest = this.api.listRuns(this.scope(), id, page, this.apiStoreId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch && this.selectedId() === id) this.loadingRuns.set(false); })).subscribe({
      next: (response) => {
        if (epoch !== this.epoch || this.selectedId() !== id) return;
        if (!response?.success || !Array.isArray(response.data)) { this.runsError.set('El historial no tiene el formato esperado.'); return; }
        this.runs.set(response.data); this.runsTotal.set(response.meta?.total ?? response.data.length); this.runPage.set(response.meta?.page ?? page);
      },
      error: (err: unknown) => { if (epoch === this.epoch && this.selectedId() === id) this.runsError.set(this.describeFailure(err, 'No se pudo cargar el historial.')); },
    });
  }

  readonly runPage = signal(1);

  submit(): void {
    this.submitAttempted.set(true);
    if (!this.canEdit || this.form.invalid || this.overflowingStoreList()) { this.form.markAllAsTouched(); return; }
    const raw = this.form.getRawValue();
    const detail = this.detail();
    this.saving.set(true); this.saveError.set(null); this.savedMessage.set(null);
    const request = this.formMode() === 'create'
      ? this.api.create(this.scope(), this.createPayload(raw), this.apiStoreId())
      : detail ? this.api.update(this.scope(), detail.id, this.updatePayload(detail, raw), this.apiStoreId()) : null;
    if (!request) { this.saving.set(false); this.saveError.set('Recarga una conexión antes de editarla.'); return; }
    const epoch = this.epoch;
    this.saveRequest = request.pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch) this.saving.set(false); })).subscribe({
      next: (response) => {
        if (epoch !== this.epoch) return;
        if (!response?.success || !response.data) { this.saveError.set('La configuración no se guardó.'); return; }
        const connection = response.data;
        this.savedMessage.set('Configuración guardada. No se ejecutó una sincronización.');
        this.saveError.set(null); this.conflict.set(false); this.detail.set(connection); this.selectedId.set(connection.id); this.formMode.set('edit'); this.patchDetail(connection);
        this.loadConnections(this.page()); this.loadRuns(connection.id, 1);
      },
      error: (err: unknown) => {
        const status = this.statusCode(err);
        if (status === 409 && this.formMode() === 'edit') {
          this.conflict.set(true);
          this.saveError.set('La conexión cambió en el servidor. Recarga la versión actual antes de guardar nuevamente.');
          return;
        }
        this.saveError.set(this.describeFailure(err, 'No se pudo guardar la configuración.'));
      },
    });
  }

  reloadAfterConflict(): void {
    const id = this.selectedId();
    if (!id || !this.conflict()) return;
    this.saveError.set('Cargando la versión actual…');
    this.loadDetail(id);
  }

  newConnection(): void { this.openCreate(); }
  closeEditor(): void {
    this.detailRequest?.unsubscribe(); this.runsRequest?.unsubscribe(); this.stopActionPolling();
    this.actionRequest?.unsubscribe(); this.actionRequest = undefined;
    this.cancelRequest?.unsubscribe(); this.cancelRequest = undefined;
    this.actionBusy.set(false); this.actionMessage.set(null); this.actionWarning.set(null); this.actionError.set(null);
    this.cancelingRunId.set(null); this.cancelReason.set(''); this.cancelBusy.set(false);
    this.detail.set(null); this.runs.set([]); this.runsTotal.set(0); this.selectedId.set(null); this.formMode.set(null);
    this.form.enable({ emitEvent: false }); this.form.reset({ name: '', connection_type: 'api_poll', enabled: false, endpoint: '', secret: '', poll_interval_minutes: 15 });
    this.saveError.set(null); this.savedMessage.set(null); this.conflict.set(false); this.submitAttempted.set(false);
  }

  onClosed(): void { this.isOpen.set(false); }

  requestSyncNow(): void {
    const connection = this.detail();
    if (!connection || connection.connection_type !== 'api_poll' || !connection.enabled || this.syncActionDisabled) return;
    const input: RequestDocumentReceptionSyncInput = {
      expected_version: connection.version,
      idempotency_key: crypto.randomUUID(),
    };
    this.actionBusy.set(true); this.actionMessage.set(null); this.actionWarning.set(null); this.actionError.set(null);
    const epoch = this.epoch;
    this.actionRequest?.unsubscribe();
    this.actionRequest = this.api.requestSync(this.scope(), connection.id, input, this.apiStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch) this.actionBusy.set(false); }))
      .subscribe({
        next: (response) => {
          if (epoch !== this.epoch || this.selectedId() !== connection.id) return;
          if (!response?.success || !response.data || !Number.isSafeInteger(response.data.run_id)) {
            this.actionError.set('La solicitud no confirmó una ejecución. Actualiza el historial antes de reintentar.');
            return;
          }
          const result = response.data;
          this.actionWarning.set(result.queued
            ? `Ejecución ${result.run_id} aceptada para encolamiento; todavía no está confirmada.`
            : `Ejecución ${result.run_id} quedó guardada y el planificador intentará encolarla.`);
          this.loadRuns(connection.id, 1);
          this.pollRun(this.scope(), connection.id, result.run_id, this.apiStoreId(), epoch, 1);
        },
        error: (error: unknown) => {
          if (epoch === this.epoch) this.actionError.set(this.describeFailure(error, 'No se pudo solicitar la sincronización.'));
        },
      });
  }

  retryRunNow(run: DocumentReceptionRun): void {
    const connection = this.detail();
    if (!connection?.enabled || !this.canSync() || !this.scopeReady() || this.actionBusy() || this.cancelBusy() || this.pollingRunId() !== null || this.syncHasUnsavedChanges || !['failed', 'partial'].includes(run.status)) return;
    this.actionBusy.set(true); this.actionMessage.set(null); this.actionWarning.set(null); this.actionError.set(null);
    const epoch = this.epoch;
    this.actionRequest?.unsubscribe();
    this.actionRequest = this.api.retryRun(this.scope(), connection.id, run.id, this.apiStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch) this.actionBusy.set(false); }))
      .subscribe({
        next: (response) => {
          if (epoch !== this.epoch || this.selectedId() !== connection.id) return;
          if (!response?.success || !response.data || response.data.run_id !== run.id) {
            this.actionError.set('El servidor no confirmó el reintento. Actualiza el historial antes de continuar.');
            return;
          }
          const result = response.data;
          this.actionWarning.set(result.queued
            ? `Reintento de ejecución ${run.id} aceptado para encolamiento; todavía no está confirmado.`
            : `Reintento ${run.id} quedó guardado; el planificador intentará encolarlo.`);
          this.loadRuns(connection.id, this.runPage());
          this.pollRun(this.scope(), connection.id, run.id, this.apiStoreId(), epoch, this.runPage());
        },
        error: (error: unknown) => {
          if (epoch === this.epoch) this.actionError.set(this.describeFailure(error, 'No se pudo solicitar el reintento.'));
        },
      });
  }

  beginCancel(run: DocumentReceptionRun): void {
    if (!this.canSync() || !this.scopeReady() || this.loadingDetail() || this.actionBusy() || this.cancelBusy() || !this.isUnresolved(run.status)) return;
    this.stopActionPolling();
    this.actionError.set(null); this.actionMessage.set(null); this.actionWarning.set(null); this.cancelReason.set(''); this.cancelingRunId.set(run.id);
  }

  cancelCancelConfirmation(): void { this.cancelingRunId.set(null); this.cancelReason.set(''); }
  onCancelReasonChange(event: Event): void { this.cancelReason.set((event.target as HTMLTextAreaElement).value); }
  cancelReasonValid(): boolean { const length = this.cancelReason().trim().length; return length >= 10 && length <= 500; }

  confirmCancelRun(run: DocumentReceptionRun): void {
    const connection = this.detail();
    if (!connection || this.cancelingRunId() !== run.id || !this.cancelReasonValid() || !this.canSync() || !this.scopeReady() || this.loadingDetail() || this.cancelBusy() || this.actionBusy() || !this.isUnresolved(run.status)) return;
    const input: CancelDocumentReceptionRunInput = { reason: this.cancelReason().trim() };
    this.cancelBusy.set(true); this.actionError.set(null); this.actionMessage.set(null); this.actionWarning.set(null);
    this.stopActionPolling();
    const epoch = this.epoch;
    this.cancelRequest?.unsubscribe();
    this.cancelRequest = this.api.cancelRun(this.scope(), connection.id, run.id, input, this.apiStoreId())
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { if (epoch === this.epoch) this.cancelBusy.set(false); }))
      .subscribe({
        next: (response) => {
          if (epoch !== this.epoch || this.selectedId() !== connection.id) return;
          const result = response?.data;
          if (!response?.success || result?.run_id !== run.id || result.status !== 'cancelled') {
            this.actionError.set('El servidor no confirmó la cancelación. Actualiza el historial para verificar el estado.');
            return;
          }
          this.runs.update((rows) => rows.map((item) => item.id === run.id ? { ...item, status: result.status } : item));
          this.actionWarning.set(result.duplicate ? `La ejecución ${run.id} ya estaba cancelada.` : `Ejecución ${run.id} cancelada y registrada en auditoría.`);
          this.cancelingRunId.set(null); this.cancelReason.set('');
          this.loadRuns(connection.id, this.runPage());
        },
        error: (error: unknown) => {
          if (epoch === this.epoch) this.actionError.set(this.describeFailure(error, 'No se pudo cancelar la ejecución. Actualiza el historial y verifica el estado.'));
        },
      });
  }

  isUnresolved(status: string): boolean { return ['pending', 'queued', 'running', 'failed', 'partial'].includes(status); }

  runDate(value: string | null): string {
    if (!value) return 'Sin iniciar';
    const tz = this.scope() === 'organization'
      ? this.stores().find((store) => store.id === this.selectedOperationalStoreId())?.timezone || 'America/Bogota'
      : this.storeSettings.timezone() || 'America/Bogota';
    return formatStoreDateTime(value, tz, { dateStyle: 'short', timeStyle: 'short' }) || 'Fecha desconocida';
  }
  storeRangeEnd(): number { return Math.min(this.storePage() * STORE_PAGE_SIZE, this.storeTotal()); }
  safeErrorCodes(run: DocumentReceptionRun): string[] { return (run.summary?.error_codes ?? []).filter((code) => /^[A-Z0-9_]{1,80}$/.test(code)).slice(0, 10); }
  safeStatus(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '').replaceAll('_', ' ').slice(0, 40) || 'desconocido'; }
  connectionTypeLabel(type: DocumentReceptionConnectionType): string { return type === 'api_poll' ? 'API de proveedor' : 'Webhook firmado'; }
  webhookUrl(relativePath: string): string {
    const base = environment.apiUrl.replace(/\/+$/, '');
    const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    return `${base}${path}`;
  }
  getConnectionType(event: Event): void { const value = (event.target as HTMLSelectElement).value; if (CONNECTION_TYPES.includes(value as DocumentReceptionConnectionType)) this.form.controls.connection_type.setValue(value as DocumentReceptionConnectionType); }
  get currentStoreName(): string { const id = this.selectedOperationalStoreId(); return this.stores().find((store) => store.id === id)?.name ?? ''; }

  private buildForm(): ConnectionForm {
    return this.fb.group({
      name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
      connection_type: new FormControl<DocumentReceptionConnectionType>('api_poll', { nonNullable: true, validators: [Validators.required] }),
      enabled: new FormControl(false, { nonNullable: true }),
      endpoint: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(HTTPS_ENDPOINT), Validators.maxLength(2048)] }),
      secret: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(4096)] }),
      poll_interval_minutes: new FormControl<number | null>(15, { validators: [Validators.required, Validators.min(1), Validators.max(1440), Validators.pattern(/^\d+$/)] }),
    }) as ConnectionForm;
  }

  private applyTypeValidators(type: DocumentReceptionConnectionType): void {
    const endpoint = this.form.controls.endpoint;
    if (type === 'api_poll') endpoint.setValidators([Validators.required, Validators.pattern(HTTPS_ENDPOINT), Validators.maxLength(2048)]);
    else { endpoint.clearValidators(); endpoint.setValue('', { emitEvent: false }); }
    endpoint.updateValueAndValidity({ emitEvent: false });
  }

  private hasOperationalStore(): boolean { const id = this.selectedOperationalStoreId(); return id !== null && this.stores().some((store) => store.id === id && store.is_active !== false); }
  private overflowingStoreList(): boolean { return this.storeTotal() > this.stores().length && this.storeTotal() > STORE_PAGE_SIZE && this.selectedOperationalStoreId() === null; }
  private apiStoreId(): number | undefined { return this.scope() === 'organization' ? this.selectedOperationalStoreId() ?? undefined : undefined; }

  private patchDetail(connection: DocumentReceptionConnection): void {
    this.form.enable({ emitEvent: false });
    this.form.patchValue({ name: connection.name, connection_type: connection.connection_type, enabled: connection.enabled, endpoint: connection.endpoint ?? '', secret: '', poll_interval_minutes: connection.poll_interval_minutes }, { emitEvent: false });
    this.form.controls.connection_type.disable({ emitEvent: false });
    this.form.controls.secret.setValidators([Validators.maxLength(4096)]); this.form.controls.secret.updateValueAndValidity({ emitEvent: false });
    this.applyTypeValidators(connection.connection_type);
    this.form.markAsPristine();
  }

  private createPayload(raw: ReturnType<ConnectionForm['getRawValue']>): CreateDocumentReceptionConnectionInput {
    return { name: raw.name.trim(), connection_type: raw.connection_type, enabled: raw.enabled, ...(raw.connection_type === 'api_poll' ? { endpoint: raw.endpoint.trim() } : {}), secret: raw.secret, poll_interval_minutes: Number(raw.poll_interval_minutes) };
  }

  private updatePayload(connection: DocumentReceptionConnection, raw: ReturnType<ConnectionForm['getRawValue']>): UpdateDocumentReceptionConnectionInput {
    return { expected_version: connection.version, name: raw.name.trim(), enabled: raw.enabled, ...(connection.connection_type === 'api_poll' ? { endpoint: raw.endpoint.trim() } : {}), ...(raw.secret !== '' ? { secret: raw.secret } : {}), poll_interval_minutes: Number(raw.poll_interval_minutes) };
  }

  private cancelStoreRequest(): void { this.storesRequest?.unsubscribe(); this.storesRequest = undefined; }
  private cancelListRequest(): void { this.listRequest?.unsubscribe(); this.listRequest = undefined; }
  private cancelContextRequests(): void {
    this.cancelListRequest(); this.detailRequest?.unsubscribe(); this.detailRequest = undefined; this.runsRequest?.unsubscribe(); this.runsRequest = undefined; this.saveRequest?.unsubscribe(); this.saveRequest = undefined;
    this.actionRequest?.unsubscribe(); this.actionRequest = undefined; this.cancelRequest?.unsubscribe(); this.cancelRequest = undefined; this.stopActionPolling();
    this.actionBusy.set(false); this.cancelBusy.set(false); this.cancelingRunId.set(null); this.cancelReason.set(''); this.actionMessage.set(null); this.actionWarning.set(null); this.actionError.set(null);
  }
  private resetSession(): void {
    this.epoch++;
    this.cancelStoreRequest(); this.cancelContextRequests();
    this.storeLoading.set(false); this.storeError.set(null); this.stores.set([]); this.storePage.set(1); this.storeTotal.set(0); this.selectedOperationalStoreId.set(null);
    this.loading.set(false); this.loadingDetail.set(false); this.loadingRuns.set(false); this.saving.set(false); this.loadError.set(null); this.runsError.set(null);
    this.list.set([]); this.total.set(0); this.page.set(1); this.selectedId.set(null); this.detail.set(null); this.runs.set([]); this.runsTotal.set(0); this.runPage.set(1);
    this.form.enable({ emitEvent: false }); this.form.reset({ name: '', connection_type: 'api_poll', enabled: false, endpoint: '', secret: '', poll_interval_minutes: 15 });
    this.formMode.set(null); this.saveError.set(null); this.savedMessage.set(null); this.conflict.set(false); this.submitAttempted.set(false);
  }

  private clearConnectionState(): void {
    this.cancelContextRequests(); this.loading.set(false); this.loadingDetail.set(false); this.loadingRuns.set(false); this.saving.set(false);
    this.list.set([]); this.total.set(0); this.page.set(1); this.selectedId.set(null); this.detail.set(null); this.runs.set([]); this.runsTotal.set(0); this.runPage.set(1);
    this.loadError.set(null); this.runsError.set(null); this.closeEditor();
  }

  private statusCode(error: unknown): number {
    return typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  }
  private describeFailure(error: unknown, fallback: string): string {
    const status = this.statusCode(error);
    if (status === 400) return describeApiFailure(error).message || 'Revisa los datos ingresados.';
    if (status === 403) return 'Tu usuario no tiene permiso para esta acción de conexiones de recepción.';
    if (status === 404) return 'La conexión ya no existe o no está disponible en esta tienda.';
    if (status === 409) return 'La ejecución cambió en el servidor. Actualiza el historial antes de volver a intentarlo.';
    return describeApiFailure(error).message || fallback;
  }
}
