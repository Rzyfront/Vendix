import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpParams } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ConfirmationModalComponent } from '../../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { environment } from '../../../../../../../../environments/environment';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';

type QueueItem = {
  id: number; organization_id: number; accounting_entity_id: number; status: 'testing' | 'verified' | 'suspended'; version: number;
  event_codes: string[]; dian_configuration_id: number | null; evidence_id: number | null; created_at: string; updated_at: string;
  organization: { name: string; slug: string };
  accounting_entity: { name: string; legal_name: string | null; tax_id: string | null; is_active: boolean; fiscal_scope: string; store_id: number | null };
  dian_configuration: { name: string; configuration_type: string; operation_mode: string; environment: string; enablement_status: string; certificate_expiry: string | null; has_certificate: boolean; has_software_id: boolean } | null;
  evidence: { evidence_type: string; created_at: string; has_artifact: boolean } | null;
};
type Page<T> = { data: T[]; meta?: { page: number; limit: number; total: number; totalPages: number } };
type Detail = QueueItem;

@Component({
  selector: 'app-buyer-event-activation', standalone: true, imports: [FormsModule, ConfirmationModalComponent],
  template: `
    <main class="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header><p class="text-xs font-semibold uppercase tracking-wide text-primary">Centro Fiscal · Facturación</p><h1 class="mt-1 text-2xl font-bold text-text-primary">Habilitaciones</h1><p class="mt-1 text-sm text-text-secondary">Revisión Vendix, no DIAN. Esta herramienta no envía eventos ni solicitudes a la DIAN.</p></header>
      <section class="rounded-card border border-border bg-surface p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <nav class="flex gap-2" aria-label="Estado de habilitación">
            @for (state of statuses; track state.id) { <button type="button" (click)="setStatus(state.id)" [attr.aria-pressed]="status() === state.id" class="rounded-full border px-3 py-2 text-sm" [class.bg-primary]="status() === state.id" [class.text-white]="status() === state.id">{{state.label}}</button> }
          </nav>
          <div class="flex gap-2"><input class="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm sm:w-64" placeholder="Buscar organización, NIT o entidad" [ngModel]="search()" (ngModelChange)="search.set($event)" (keyup.enter)="onSearch()" aria-label="Buscar habilitaciones"><button type="button" class="rounded bg-primary px-4 py-2 text-sm text-white" (click)="onSearch()">Buscar</button></div>
        </div>
      </section>
      @if (error()) { <p role="alert" class="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{{error()}}</p> }
      @if (loading()) { <p class="p-8 text-center text-sm text-text-secondary">Cargando solicitudes…</p> }
      @else if (!items().length) { <section class="rounded-card border border-border bg-surface p-8 text-center text-sm text-text-secondary">No hay solicitudes en esta vista.</section> }
      @else { <section class="space-y-3" aria-label="Solicitudes de habilitación">
        @for (item of items(); track item.id) { <article class="rounded-card border border-border bg-surface p-4 sm:p-5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div class="flex flex-wrap items-center gap-2"><h2 class="font-semibold text-text-primary">{{item.organization.name}}</h2><span class="rounded-full bg-background px-2 py-1 text-xs">{{statusLabel(item.status)}}</span></div><p class="mt-1 text-sm text-text-secondary">{{item.accounting_entity.legal_name || item.accounting_entity.name}} · NIT {{item.accounting_entity.tax_id}}</p><p class="text-xs text-text-secondary">{{item.organization.slug}} · {{item.accounting_entity.fiscal_scope}} · versión {{item.version}}</p></div><button type="button" class="rounded border border-border px-4 py-2 text-sm" (click)="inspect(item)">Revisar detalle</button></div>
          @if (selected()?.id === item.id) { <div class="mt-4 space-y-4 border-t border-border pt-4">
            @if (detailLoading()) { <p class="p-4 text-sm text-text-secondary" role="status">Cargando detalle actualizado…</p> }
            @else if (detailError()) { <div class="flex flex-col gap-2 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert"><p>{{detailError()}}</p><button type="button" class="w-fit rounded border border-border px-3 py-2 text-text-primary" (click)="inspect(item)">Reintentar detalle</button></div> }
            @else if (!selectedDetail()) { <p class="p-4 text-sm text-text-secondary" role="status">Detalle no disponible; vuelve a intentarlo.</p> }
            @else if (!sameEntity(item, selectedDetail()!)) { <p class="rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">El detalle recibido no corresponde a la entidad de la cola. No se permiten acciones; recarga la cola.</p> }
            @else { @if (selectedDetail()!.status !== status() || selectedDetail()!.status !== item.status) { <p class="rounded border border-warning/40 bg-warning/5 p-3 text-sm" role="alert">El estado cambió desde que se cargó la cola. No se permiten acciones. Recarga la cola y vuelve a inspeccionar.</p> }
            <div class="grid gap-3 text-sm sm:grid-cols-2"><div><b>Estado actualizado</b><p>{{statusLabel(selectedDetail()!.status)}} · versión {{selectedDetail()!.version}}</p></div><div><b>Entidad</b><p>{{selectedDetail()!.accounting_entity.name}} · {{selectedDetail()!.accounting_entity.is_active ? 'Activa' : 'Inactiva'}}</p></div><div><b>Eventos solicitados</b><p>{{selectedDetail()!.event_codes.join(', ') || 'Sin códigos'}}</p></div><div><b>Configuración DIAN asociada</b><p>{{selectedDetail()!.dian_configuration?.name || 'No asociada'}} · {{selectedDetail()!.dian_configuration?.environment || '—'}} · {{selectedDetail()!.dian_configuration?.enablement_status || '—'}}</p></div><div><b>Credencial / certificado</b><p>{{selectedDetail()!.dian_configuration?.has_certificate ? 'Certificado registrado' : 'Sin certificado'}} · {{selectedDetail()!.dian_configuration?.has_software_id ? 'Software ID registrado' : 'Sin software ID'}}</p></div><div><b>Evidencia</b><p>{{selectedDetail()!.evidence?.evidence_type || 'No registrada'}} · {{selectedDetail()!.evidence?.has_artifact ? 'Artefacto adjunto' : 'Sin artefacto'}}</p></div></div>
            <div class="rounded border border-warning/40 bg-warning/5 p-3 text-sm"><b>Verificación independiente obligatoria.</b> Estos metadatos no prueban la habilitación ante DIAN. Antes de verificar, revisa por fuera de Vendix el artefacto o la fuente DIAN correspondiente.</div>
            @if (canVerify() && selectedDetail()!.status === 'testing' && selectedDetail()!.status === item.status && selectedDetail()!.status === status()) { <form class="grid gap-3 rounded border border-border p-3" (submit)="$event.preventDefault(); requestVerify(item)"><h3 class="font-semibold">Confirmar revisión</h3><label class="grid gap-1 text-sm">Fuente de verificación externa<select class="rounded border border-border bg-background p-2" [(ngModel)]="source" name="source" required><option value="">Selecciona la fuente</option><option value="test_set">Conjunto de pruebas DIAN</option><option value="convalidated">Documento validado por DIAN</option><option value="dian_portal">Portal DIAN</option></select></label><label class="grid gap-1 text-sm">Nota de revisión (20–500 caracteres)<textarea class="rounded border border-border bg-background p-2" [(ngModel)]="note" name="note" minlength="20" maxlength="500" required rows="3"></textarea></label><label class="flex items-start gap-2 text-sm"><input type="checkbox" [(ngModel)]="acknowledged" name="acknowledged" required><span>Confirmo que revisé independientemente evidencia o fuente DIAN; los metadatos de Vendix no son prueba de habilitación.</span></label><button class="w-fit rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50" [disabled]="submitting() || !acknowledged || note.trim().length < 20 || note.trim().length > 500">{{submitting() ? 'Procesando…' : 'Verificar habilitación'}}</button></form> }
            @if (canSuspend() && selectedDetail()!.status !== 'suspended' && selectedDetail()!.status === item.status && selectedDetail()!.status === status()) { <form class="grid gap-3 rounded border border-danger/30 p-3" (submit)="$event.preventDefault(); requestSuspend(item)"><h3 class="font-semibold">Suspender habilitación</h3><label class="grid gap-1 text-sm">Motivo (20–500 caracteres)<textarea class="rounded border border-border bg-background p-2" [(ngModel)]="reason" name="reason" minlength="20" maxlength="500" required rows="2"></textarea></label><button class="w-fit rounded bg-danger px-4 py-2 text-sm text-white disabled:opacity-50" [disabled]="submitting() || reason.trim().length < 20 || reason.trim().length > 500">Suspender…</button></form> }
            }
          </div> }
        </article> }
      </section> }
      <footer class="flex items-center justify-between rounded-card border border-border bg-surface p-3 text-sm"><span>Página {{page()}} de {{totalPages()}} · {{total()}} solicitudes</span><div class="flex gap-2"><button class="rounded border border-border px-3 py-2 disabled:opacity-40" [disabled]="page() <= 1 || loading()" (click)="changePage(-1)">Anterior</button><button class="rounded border border-border px-3 py-2 disabled:opacity-40" [disabled]="page() >= totalPages() || loading()" (click)="changePage(1)">Siguiente</button></div></footer>
      <app-confirmation-modal [(isOpen)]="confirmOpen" [title]="confirmAction() === 'verify' ? 'Verificar habilitación' : 'Suspender habilitación'" [message]="confirmAction() === 'verify' ? 'Confirma que verificaste por una fuente DIAN externa. Esta acción solo registra la revisión Vendix y no envía nada a DIAN.' : '¿Confirmas suspender esta habilitación? Esta acción solo afecta el registro de revisión Vendix.'" [confirmText]="confirmAction() === 'verify' ? 'Verificar' : 'Suspender'" [confirmVariant]="confirmAction() === 'verify' ? 'primary' : 'danger'" (confirm)="confirmAction() === 'verify' ? verify() : suspend()" (cancel)="confirmOpen.set(false)"></app-confirmation-modal>
    </main>`
})
export class BuyerEventActivationComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthFacade);
  private readonly base = `${environment.apiUrl}/super-admin/fiscal/invoicing/received-documents/buyer-event-enablement`;
  readonly statuses = [{ id: 'testing', label: 'En prueba' }, { id: 'verified', label: 'Verificadas' }, { id: 'suspended', label: 'Suspendidas' }] as const;
  readonly status = signal<'testing' | 'verified' | 'suspended'>('testing'); readonly search = signal(''); readonly page = signal(1); readonly items = signal<QueueItem[]>([]);
  readonly total = signal(0); readonly totalPages = signal(1); readonly loading = signal(false); readonly submitting = signal(false); readonly error = signal(''); readonly selected = signal<QueueItem | null>(null); readonly selectedDetail = signal<Detail | null>(null);
  readonly detailLoading = signal(false); readonly detailError = signal('');
  readonly canVerify = computed(() => this.auth.hasPermission('superadmin:invoicing:received:events:verify'));
  readonly canSuspend = computed(() => this.auth.hasPermission('superadmin:invoicing:received:events:suspend'));
  readonly confirmOpen = signal(false); readonly confirmAction = signal<'verify' | 'suspend'>('verify');
  private loadGeneration = 0; private detailGeneration = 0;
  private readonly destroyRef = inject(DestroyRef);
  source = ''; note = ''; reason = ''; acknowledged = false;
  constructor() { this.load(); }
  setStatus(state: 'testing' | 'verified' | 'suspended') { this.status.set(state); this.page.set(1); this.selected.set(null); this.selectedDetail.set(null); this.detailLoading.set(false); this.detailError.set(''); this.detailGeneration++; this.confirmOpen.set(false); this.load(); }
  changePage(delta: number) { this.page.update(v => v + delta); this.selected.set(null); this.selectedDetail.set(null); this.detailLoading.set(false); this.detailError.set(''); this.detailGeneration++; this.confirmOpen.set(false); this.load(); }
  onSearch() { this.page.set(1); this.selected.set(null); this.selectedDetail.set(null); this.detailLoading.set(false); this.detailError.set(''); this.detailGeneration++; this.confirmOpen.set(false); this.load(); }
  statusLabel(s: string) { return ({ testing: 'En prueba', verified: 'Verificada', suspended: 'Suspendida' } as Record<string,string>)[s] || s; }
  sameEntity(queue: QueueItem, detail: Detail) { return queue.organization_id === detail.organization_id && queue.accounting_entity_id === detail.accounting_entity_id; }
  load(clearError = true) {
    const generation = ++this.loadGeneration;
    this.loading.set(true); if (clearError) this.error.set('');
    let params = new HttpParams().set('status', this.status()).set('page', this.page()).set('limit', 20);
    if (this.search().trim()) params = params.set('search', this.search().trim().slice(0, 100));
    this.http.get<Page<QueueItem>>(this.base, { params }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: response => { if (generation !== this.loadGeneration) return; this.items.set(response.data || []); this.total.set(response.meta?.total || 0); this.totalPages.set(Math.max(1, response.meta?.totalPages || 1)); this.loading.set(false); }, error: () => { if (generation !== this.loadGeneration) return; this.error.set('No fue posible cargar la cola. Verifica tu acceso e intenta de nuevo.'); this.loading.set(false); } });
  }
  inspect(item: QueueItem) {
    const generation = ++this.detailGeneration;
    this.selected.set(item); this.selectedDetail.set(null); this.detailError.set(''); this.detailLoading.set(true); this.source = ''; this.note = ''; this.reason = ''; this.acknowledged = false;
    this.http.get<{ data: Detail }>(`${this.base}/${item.organization_id}/${item.accounting_entity_id}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: response => { if (generation === this.detailGeneration && this.selected()?.id === item.id) { this.selectedDetail.set(response.data); this.detailLoading.set(false); } }, error: () => { if (generation === this.detailGeneration) { this.detailLoading.set(false); this.detailError.set('No fue posible cargar el detalle actualizado.'); } } });
  }
  requestVerify(item: QueueItem) {
    const detail = this.selectedDetail();
    if (!this.canVerify() || !detail || this.selected()?.id !== item.id || !this.sameEntity(item, detail) || item.status !== 'testing' || detail.status !== item.status || detail.status !== this.status() || !this.acknowledged || this.note.trim().length < 20 || this.note.trim().length > 500 || !['test_set', 'convalidated', 'dian_portal'].includes(this.source) || this.submitting()) return;
    this.selected.set(item); this.confirmAction.set('verify'); this.confirmOpen.set(true);
  }
  verify() {
    const item = this.selected(); const detail = this.selectedDetail();
    if (!item || !detail || !this.canVerify() || !this.sameEntity(item, detail) || item.status !== 'testing' || detail.status !== item.status || detail.status !== this.status() || !this.acknowledged || this.note.trim().length < 20 || this.note.trim().length > 500 || !['test_set', 'convalidated', 'dian_portal'].includes(this.source) || this.submitting()) return;
    this.confirmOpen.set(false);
    this.submitting.set(true); this.error.set('');
    this.http.post(`${this.base}/${item.organization_id}/${item.accounting_entity_id}/verify`, { expected_version: detail.version, verification_source: this.source, review_note: this.note.trim() }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: () => { this.submitting.set(false); this.selected.set(null); this.selectedDetail.set(null); this.load(); }, error: err => { this.submitting.set(false); const stale = err.status === 409; if (stale) { this.selected.set(null); this.selectedDetail.set(null); } this.load(false); this.error.set(stale ? 'La solicitud cambió desde que la abriste. Se recargó la cola; vuelve a abrir el detalle y revisar antes de actuar.' : 'No fue posible verificar. Revisa los datos y vuelve a intentar.'); } });
  }
  requestSuspend(item: QueueItem) {
    const detail = this.selectedDetail();
    if (!this.canSuspend() || !detail || this.selected()?.id !== item.id || !this.sameEntity(item, detail) || item.status !== detail.status || detail.status === 'suspended' || detail.status !== this.status() || this.reason.trim().length < 20 || this.reason.trim().length > 500 || this.submitting()) return;
    this.selected.set(item); this.confirmAction.set('suspend'); this.confirmOpen.set(true);
  }
  suspend() {
    const item = this.selected(); const detail = this.selectedDetail();
    if (!item || !detail || !this.canSuspend() || !this.sameEntity(item, detail) || item.status !== detail.status || detail.status === 'suspended' || detail.status !== this.status() || this.reason.trim().length < 20 || this.reason.trim().length > 500 || this.submitting()) return;
    this.confirmOpen.set(false);
    this.submitting.set(true); this.error.set('');
    this.http.post(`${this.base}/${item.organization_id}/${item.accounting_entity_id}/suspend`, { expected_version: detail.version, reason: this.reason.trim() }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: () => { this.submitting.set(false); this.selected.set(null); this.selectedDetail.set(null); this.load(); }, error: err => { this.submitting.set(false); const stale = err.status === 409; if (stale) { this.selected.set(null); this.selectedDetail.set(null); } this.load(false); this.error.set(stale ? 'La solicitud cambió desde que la abriste. Se recargó la cola; vuelve a abrir el detalle y revisar antes de actuar.' : 'No fue posible suspender la habilitación.'); } });
  }
}
