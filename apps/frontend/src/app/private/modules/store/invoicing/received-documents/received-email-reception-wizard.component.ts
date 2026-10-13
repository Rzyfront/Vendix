import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Observable, Subscription, catchError, finalize, forkJoin, of, switchMap, timeout } from 'rxjs';
import { ButtonComponent, IconComponent, InputComponent, ModalComponent, StepsLineComponent, type StepsLineItem } from '../../../../../shared/components/index';
import type { ReceivedDocumentsScope } from './received-documents.interface';
import type { ReceivedEmailConfiguration, ReceivedEmailGmailCode, ReceivedEmailMessage, ReceivedEmailProvider, ReceivedEmailStatus } from './received-email-reception.interface';
import { RECEIVED_EMAIL_DIAN_BADGE, receivedEmailReason, receivedEmailStatusCopy, receivedEmailUsableCode } from './received-email-reception-projection.util';
import { ReceivedEmailReceptionService } from './received-email-reception.service';

const STEPS: StepsLineItem[] = [{ label: 'Tu dirección' }, { label: 'Tu correo' }, { label: 'Prueba' }];
const EMPTY_CODE: ReceivedEmailGmailCode = { available: false, code: null, expires_at: null };

/** Feature-local wizard. Context changes invalidate every request and erase transient private data. */
@Component({
  selector: 'app-received-email-reception-wizard', standalone: true,
  imports: [ButtonComponent, IconComponent, InputComponent, ModalComponent, StepsLineComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [(isOpen)]="isOpen" title="Recibe tus facturas por correo" size="lg" [dialog]="true"
      [fullScreenOnMobile]="true" [closeOnBackdrop]="false" [canClose]="canCloseModal" (cancel)="close()">
      @if (scope() !== 'store') {
        <p class="text-sm text-text-secondary">La recepción se configura desde cada tienda. Cambia al entorno de una tienda autorizada para continuar.</p>
        <app-button variant="outline" (clicked)="storeContextRequested.emit()">Cambiar a una tienda</app-button>
      } @else if (!contextReady() || !tenantKey()) {
        <p role="status" class="text-sm text-text-secondary">Esperando el contexto de tu tienda…</p>
      } @else if (!canRead()) {
        <p role="note" class="text-sm text-text-secondary">No tienes permiso para consultar la recepción de esta tienda.</p>
      } @else {
        <div class="email-wizard">
          <app-steps-line [steps]="steps" [currentStep]="step()" [clickable]="false" size="sm" />
          @if (mutationError() || error()) { <div role="alert" class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error"><p>{{ mutationError() || error() }}</p><app-button variant="outline" [disabled]="loading() || busy()" (clicked)="retryStatus()">Reintentar consulta</app-button></div> }
          @if (loading() && !status()) { <p role="status" class="text-sm text-text-secondary">Consultando tu recepción…</p> }
          @if (status() && !status()!.pilot_available) {
            <p role="note" class="text-sm text-text-secondary">La recepción por correo todavía no está disponible para esta tienda. Consulta con tu administrador.</p>
          } @else if (!canConfigure()) {
            <p role="note" class="text-sm text-text-secondary">Puedes consultar el estado. Pídele a tu administrador que configure la dirección de recepción.</p>
            <p class="font-medium text-text-primary">{{ statusCopy().title }}</p>
          } @else if (step() === 0) {
            <section aria-labelledby="email-address-heading" class="email-section">
              <h2 id="email-address-heading" class="font-semibold text-text-primary">Tu dirección de facturas</h2>
              <p class="text-sm text-text-secondary">Activa tu dirección Vendix. No necesitamos la contraseña de tu correo.</p>
              @if (configurationForContext()?.address) {
                <app-input label="Tu correo de facturas" [formControl]="addressControl" [readonly]="true" size="lg" />
                <app-button variant="outline" (clicked)="copyAddress()"><app-icon name="copy" slot="icon" />Copiar dirección</app-button>
                @if (!configurationForContext()?.enabled) {
                  <p class="text-sm text-text-secondary">Pausado. Las facturas guardadas siguen en tu Buzón.</p>
                  <app-button [disabled]="busy() || !mayConfigure()" [loading]="busy()" (clicked)="resume()">Reanudar recepción</app-button>
                }
              } @else {
                <label class="email-consent text-sm text-text-primary">
                  <input type="checkbox" [formControl]="consentControl" />
                  <span>Sólo reenvía facturas. Vendix procesará los datos del correo y guardará sus archivos para que puedas revisarlos; usaremos almacenamiento AWS en Estados Unidos, región Norte de Virginia.</span>
                </label>
                <app-button [disabled]="!mayActivate()" [loading]="busy()" [showTextWhileLoading]="true" (clicked)="activate()">{{ busy() ? 'Creando tu dirección…' : 'Activar recepción' }}</app-button>
              }
            </section>
          } @else if (step() === 1) {
            <section aria-labelledby="email-provider-heading" class="email-section">
              <h2 id="email-provider-heading" class="font-semibold text-text-primary">¿Dónde recibes las facturas de tus proveedores?</h2>
              <div role="group" aria-label="Elige dónde recibes las facturas" class="email-options">
                @for (option of providers; track option.value) {
                  <app-button variant="outline" [ariaPressed]="provider() === option.value" (clicked)="chooseProvider(option.value)">{{ option.label }}</app-button>
                }
              </div>
              @if (provider() === 'gmail') {
                <div class="email-guide text-sm text-text-secondary">
                  <ol><li>Desde un ordenador: Gmail → Configuración → Ver todos los ajustes → Reenvío → Añadir dirección. Pega tu dirección Vendix.</li>
                    <li>Si Gmail envía un código, vuelve aquí, cópialo y pégalo en Gmail. Si sólo envía un enlace, no lo abrimos ni confirmamos el reenvío por ti; usa la alternativa con proveedores. Hazlo sólo si tú solicitaste el reenvío.</li>
                    <li><strong class="text-text-primary">Deja el reenvío general desactivado.</strong> Crea un filtro con esta búsqueda y elige reenviar a tu dirección Vendix; conserva una copia.</li></ol>
                  <code class="email-filter">has:attachment {{ gmailFilter }}</code>
                  <p>Este filtro sólo reenvía las facturas nuevas que coincidan. Revisa los resultados antes de guardarlo; otros correos con esos archivos pueden llegar y Vendix los clasificará.</p>
                  <p>Si usas Gmail de empresa (Workspace), tu administrador debe permitir el reenvío automático.</p><a href="https://support.google.com/mail/answer/10957?hl=es" target="_blank" rel="noopener noreferrer" class="email-link">Guía oficial de Gmail</a>
                </div>
                @if (usableCode(); as code) {
                  <div role="status" class="rounded-lg border border-primary/30 bg-surface p-3 text-sm text-text-primary">
                    <p>Gmail te envió un código: <strong>{{ code }}</strong></p>
                    <p>Pégalo en Gmail → Configuración → Reenvío. Hazlo sólo si tú solicitaste el reenvío.</p>
                    <app-button variant="outline" (clicked)="copyCode()">Copiar código</app-button>
                  </div>
                } @else {
                  <p class="text-sm text-text-secondary">{{ codeExpired() ? 'Solicita otro código desde Gmail.' : 'Esperando el código de Gmail. Si sólo recibes un enlace o no aparece un código, puedes usar esta dirección directamente con tus proveedores mientras soporte te ayuda.' }}</p>
                }
              } @else if (provider() === 'outlook' || provider() === 'microsoft365') {
                <div class="email-guide text-sm text-text-secondary">
                  <ol><li>Outlook → Configuración → Correo → Reglas → Nueva regla.</li><li>Elige mensajes con adjuntos y, si permite, archivos ZIP/XML.</li><li>Redirige o reenvía a tu dirección Vendix, guarda la regla y conserva una copia.</li></ol><a href="https://support.microsoft.com/en-us/outlook/mail/use-rules-to-automatically-forward-messages" target="_blank" rel="noopener noreferrer" class="email-link">Guía oficial de Outlook</a>
                  @if (provider() === 'microsoft365') { <p>Si tu empresa bloquea el reenvío externo, pídele a tu administrador que permita el envío a esta dirección. No necesitas desactivar la seguridad de toda la empresa.</p> }
                </div>
              } @else if (provider() === 'suppliers') {
                <p class="text-sm text-text-secondary">Dale esta dirección a tus proveedores y pídeles que envíen directamente sus facturas con el archivo ZIP o XML.</p>
              }
              <p class="text-sm text-text-secondary">También puedes dar esta dirección a tus proveedores para que envíen las facturas directamente.</p>
              <app-button variant="outline" [disabled]="!configurationForContext()?.address" (clicked)="copyAddress()">Copiar dirección</app-button>
              <details class="email-guide text-sm text-text-secondary"><summary>¿Facturas anteriores?</summary>
                <p>En Gmail, selecciónalas → ⋮ → Reenviar como archivo adjunto. En Outlook, usa Reenviar como datos adjuntos. Envíalas a tu dirección Vendix en grupos pequeños: hasta 20 correos y 20 MB por envío. Si Gmail los convierte en un enlace de Drive, reduce el grupo.</p>
                <p>El filtro sólo reenvía mensajes nuevos; no envía automáticamente tus facturas anteriores.</p>
              </details>
            </section>
          } @else {
            <section aria-labelledby="email-test-heading" class="email-section">
              <h2 id="email-test-heading" class="font-semibold text-text-primary">Prueba con una factura</h2>
              <p class="text-sm text-text-secondary">Reenvía ahora una factura con su archivo ZIP o XML. Revisaremos si está a nombre de tu negocio.</p>
              @if (provider() === 'gmail' && usableCode(); as code) {
                <div role="status" class="rounded-lg border border-primary/30 bg-surface p-3 text-sm text-text-primary"><p>Gmail te envió un código: <strong>{{ code }}</strong>. Pégalo en Gmail → Configuración → Reenvío, sólo si tú lo solicitaste.</p><app-button variant="outline" (clicked)="copyCode()">Copiar código</app-button></div>
              }
              @if (hasReceivedInvoice()) {
                <p role="status" class="font-medium text-text-primary">Factura recibida. Ya está en tu Buzón para revisar.</p>
                <a routerLink="/admin/invoicing/received-documents" (click)="close()" class="email-link">Abrir Buzón</a>
              } @else if (failureReason(); as reason) {
                <div role="status" class="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-text-primary">
                  <p>Recibimos tu correo, pero no pudimos agregar la factura.</p><p class="font-medium">{{ reason.title }}</p><p>{{ reason.description }}</p>
                  <app-button variant="outline" (clicked)="historyRequested.emit()">Ver qué pasó</app-button>
                  @if (reason.action === 'manual') { <app-button variant="outline" (clicked)="manualImportRequested.emit()">Importar manualmente</app-button> }
                </div>
              } @else { <p role="status" class="font-medium text-text-primary">{{ statusCopy().title }}</p> }
              <p class="text-sm text-text-secondary">Se actualiza cada 30 segundos. Puedes cerrar y volver después. Sin conexión o si esta ventana no está visible, pausamos la consulta; ante un fallo esperamos más antes de reintentar.</p>
              @if (provider() === 'gmail') { <a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer" class="email-link">Abrir Gmail</a> }
              @else if (provider() === 'outlook' || provider() === 'microsoft365') { <a href="https://outlook.office.com/mail/" target="_blank" rel="noopener noreferrer" class="email-link">Abrir Outlook</a> }
              <p class="text-sm text-text-secondary">{{ dianBadge }}. Confirma los datos con tu proveedor antes de pagar.</p>
            </section>
          }
          @if (copied()) { <p role="status" class="text-sm text-text-secondary">{{ copied() }}</p> }
        </div>
      }
      <div slot="footer" class="email-footer">
        <app-button variant="outline" [disabled]="busy()" (clicked)="close()">Cerrar</app-button>
        @if (step() > 0 && scope() === 'store' && canConfigure()) { <app-button variant="outline" [disabled]="busy()" (clicked)="previous()">Volver</app-button> }
        @if (step() < 2 && scope() === 'store' && canConfigure()) { <app-button [disabled]="!mayContinue()" (clicked)="next()">{{ step() === 0 ? 'Continuar' : 'Continuar a la prueba' }}</app-button> }
      </div>
    </app-modal>
  `,
  styles: [`
    .email-wizard,.email-section{display:flex;flex-direction:column;gap:1rem;min-width:0}
    .email-options,.email-footer{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}
    .email-footer{justify-content:flex-end}.email-consent{display:flex;gap:.75rem;align-items:flex-start}
    .email-consent input{min-width:1.25rem;min-height:1.25rem;margin-top:.2rem;accent-color:var(--color-primary)}
    .email-guide p{margin-top:.75rem}.email-guide ol{list-style:decimal;padding-left:1.5rem;line-height:1.6}
    .email-filter{display:block;padding:.75rem;margin-top:.75rem;overflow-wrap:anywhere;white-space:normal;background:var(--color-surface);border:1px solid var(--color-border);border-radius:.5rem;color:var(--color-text-primary)}
    .email-link{display:inline-flex;align-items:center;min-height:44px;padding:.5rem .75rem;color:var(--color-primary);text-decoration:underline;border-radius:.5rem}
    .email-link:focus-visible,summary:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}summary{cursor:pointer;min-height:44px;display:flex;align-items:center}
  `],
})
export class ReceivedEmailReceptionWizardComponent {
  private readonly api = inject(ReceivedEmailReceptionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly window = this.browser ? this.document.defaultView : null;
  readonly isOpen = model(false);
  readonly tenantKey = input.required<string>();
  readonly scope = input<ReceivedDocumentsScope>('store');
  readonly contextReady = input(false);
  readonly canRead = input(false);
  readonly canConfigure = input(false);
  readonly protectedChange = output<boolean>();
  readonly completed = output<void>();
  readonly historyRequested = output<void>();
  readonly manualImportRequested = output<void>();
  readonly storeContextRequested = output<void>();
  readonly step = signal(0);
  readonly provider = signal<ReceivedEmailProvider | null>(null);
  readonly status = signal<ReceivedEmailStatus | null>(null);
  readonly configuration = signal<ReceivedEmailConfiguration | null>(null);
  private readonly snapshotKey = signal('');
  readonly configurationForContext = computed(() => this.snapshotKey() === this.liveKey() ? this.configuration() : null);
  readonly hasReceivedInvoice = computed(() => {
    const first = this.status()?.first_valid_received_at;
    return this.snapshotKey() === this.liveKey() && !!first && Number.isFinite(Date.parse(first));
  });
  readonly gmailCode = signal<ReceivedEmailGmailCode | null>(null);
  readonly latestProblem = signal<ReceivedEmailMessage | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly mutationError = signal<string | null>(null);
  readonly copied = signal<string | null>(null);
  readonly codeExpired = signal(false);
  readonly now = signal(Date.now());
  readonly consentControl = new FormControl(false, { nonNullable: true });
  readonly addressControl = new FormControl('', { nonNullable: true });
  readonly consent = toSignal(this.consentControl.valueChanges, { initialValue: false });
  readonly steps = STEPS;
  readonly dianBadge = RECEIVED_EMAIL_DIAN_BADGE;
  readonly gmailFilter = '{filename:zip filename:xml}';
  readonly providers: Array<{ value: ReceivedEmailProvider; label: string }> = [
    { value: 'gmail', label: 'Gmail' }, { value: 'outlook', label: 'Outlook-Hotmail' },
    { value: 'microsoft365', label: 'Microsoft 365 empresa' }, { value: 'suppliers', label: 'Se lo daré a mis proveedores' },
  ];
  readonly usableCode = computed(() => this.canConfigure() && this.scope() === 'store' && this.snapshotKey() === this.liveKey() ? receivedEmailUsableCode(this.gmailCode(), this.now()) : null);
  readonly statusCopy = computed(() => receivedEmailStatusCopy(this.status(), this.now()));
  readonly failureReason = computed(() => {
    const message = this.latestProblem();
    const part = message?.parts.find((item) => item.reason_code);
    const reason = part?.reason_code ?? this.status()?.last_error_code;
    return reason && !['DUPLICATE', 'DUPLICATE_OTHER_STORE', 'GMAIL_VERIFICATION_CODE'].includes(reason) ? receivedEmailReason(reason, part?.reason_details) : null;
  });
  readonly mayConfigure = computed(() => this.isOpen() && this.scope() === 'store' && this.contextReady() && !!this.tenantKey() && this.canConfigure() && this.status()?.pilot_available === true && this.snapshotKey() === this.liveKey());
  readonly mayActivate = computed(() => this.mayConfigure() && !this.busy() && this.consent() && !this.configurationForContext()?.configured && !!this.configurationForContext()?.policy_version);
  readonly mayContinue = computed(() => this.mayConfigure() && !this.busy() && !!this.configurationForContext()?.address && (this.step() === 0 || this.provider() !== null));
  readonly canCloseModal = (): boolean => !this.busy();
  private generation = 0;
  private activeRequest?: Subscription;
  private mutationRequest?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private followup = false;
  private failures = 0;
  private identity = '';
  private destroyed = false;
  private announced = false;

  constructor() {
    effect(() => {
      const key = this.liveKey();
      const identity = `${this.scope()}:${this.tenantKey()}:${this.contextReady()}:${this.canRead()}:${this.canConfigure()}`;
      const open = this.isOpen();
      untracked(() => {
        const changed = identity !== this.identity;
        this.identity = identity;
        this.invalidate();
        if (changed) { this.step.set(0); this.provider.set(null); }
        this.protectedChange.emit(open);
        if (open && this.mayRead()) this.refresh();
      });
      // Reading the full key makes permission/context changes invalidate requests too.
      void key;
    });
    const availability = () => {
      this.clearPollTimer(); this.now.set(Date.now());
      if (this.mayRead()) this.refresh();
      else { this.clearCodeTimer(); this.gmailCode.set(null); this.activeRequest?.unsubscribe(); this.inFlight = false; this.loading.set(false); }
    };
    if (this.browser) {
      this.document.addEventListener('visibilitychange', availability);
      this.window?.addEventListener('online', availability);
      this.window?.addEventListener('offline', availability);
    }
    this.destroyRef.onDestroy(() => {
      this.destroyed = true; this.invalidate(); this.protectedChange.emit(false);
      this.document.removeEventListener('visibilitychange', availability);
      this.window?.removeEventListener('online', availability); this.window?.removeEventListener('offline', availability);
    });
  }

  next(): void { if (this.mayContinue()) { this.step.update((value) => Math.min(2, value + 1)); this.refresh(); } }
  previous(): void { if (!this.busy()) this.step.update((value) => Math.max(0, value - 1)); }
  close(): void { if (this.canCloseModal()) this.isOpen.set(false); }
  chooseProvider(provider: ReceivedEmailProvider): void { this.provider.set(provider); this.gmailCode.set(null); this.codeExpired.set(false); this.refresh(); }
  retryStatus(): void { this.mutationError.set(null); this.refresh(); }

  activate(): void {
    if (!this.mayActivate()) return;
    this.mutate(this.api.activate({ consent: true, policy_version: this.configuration()!.policy_version }), 'No pudimos activarla. Actualiza el estado antes de volver a intentarlo.');
  }
  resume(): void {
    const version = this.configurationForContext()?.version;
    if (!this.mayConfigure() || !version || this.busy()) return;
    this.mutate(this.api.update({ expected_version: version, enabled: true }), 'No pudimos reanudar la recepción. Revisa el estado e inténtalo nuevamente.');
  }

  refresh(): void {
    if (!this.mayRead() || this.busy()) return;
    if (this.inFlight) { this.followup = true; return; }
    this.clearPollTimer(); this.loading.set(true); this.inFlight = true;
    const generation = this.generation; const key = this.liveKey(); const provider = this.provider();
    this.activeRequest = this.api.status().pipe(
      switchMap((status) => {
        if (!this.current(generation, key)) return EMPTY;
        return forkJoin({
        status: of(status),
        configuration: status.pilot_available && this.canConfigure() ? this.api.configuration() : of(null),
        code: status.pilot_available && status.configured && this.canConfigure() && provider === 'gmail'
          ? this.api.gmailCode().pipe(catchError(() => of(EMPTY_CODE))) : of(null),
        problem: this.step() === 2 && status.not_processed_count > 0
          ? this.api.messages({ page: 1, limit: 1, view: 'not_processed' }).pipe(catchError(() => of(null))) : of(null),
      }); }), timeout(20_000), takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        if (!this.current(generation, key)) return;
        this.inFlight = false; this.loading.set(false);
        if (this.followup) { this.followup = false; this.refresh(); } else this.schedule();
      }),
    ).subscribe({
      next: (result) => {
        if (!this.current(generation, key)) return;
        this.failures = 0; this.error.set(null); this.now.set(Date.now());
        this.snapshotKey.set(key); this.status.set(result.status); this.configuration.set(result.configuration);
        this.addressControl.setValue(result.configuration?.address ?? '');
        this.latestProblem.set(result.problem?.data[0] ?? null);
        this.gmailCode.set(this.provider() === provider && provider === 'gmail' ? result.code : null);
        this.expireCode();
        if (result.status.pilot_available && this.hasReceivedInvoice() && !this.announced) { this.announced = true; this.completed.emit(); }
      },
      error: () => {
        if (!this.current(generation, key)) return;
        this.failures++; this.gmailCode.set(null);
        this.error.set('No pudimos actualizar el estado. Volveremos a intentarlo; tus facturas guardadas siguen disponibles.');
      },
    });
  }

  copyAddress(): void { if (this.mayConfigure()) this.copy(this.configurationForContext()?.address ?? null, 'Dirección copiada'); }
  copyCode(): void { if (this.mayConfigure()) this.copy(receivedEmailUsableCode(this.gmailCode()), 'Código copiado'); }

  private mutate(request: Observable<ReceivedEmailConfiguration>, failure: string): void {
    this.busy.set(true); this.followup = false;
    this.activeRequest?.unsubscribe(); this.clearPollTimer(); this.inFlight = false;
    this.error.set(null); this.mutationError.set(null);
    const generation = this.generation; const key = this.liveKey();
    this.mutationRequest = request.pipe(timeout(30_000), takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (this.current(generation, key)) { this.busy.set(false); this.refresh(); }
    })).subscribe({
      next: (configuration) => {
        if (!this.current(generation, key)) return;
        this.snapshotKey.set(key); this.configuration.set(configuration); this.addressControl.setValue(configuration.address ?? '');
      },
      error: () => { if (this.current(generation, key)) this.mutationError.set(failure); },
    });
  }
  private copy(value: string | null, success: string): void {
    if (!value || !this.window?.navigator.clipboard) { this.copied.set('Selecciona la dirección o el código y cópialo manualmente.'); return; }
    const generation = this.generation; const key = this.liveKey();
    void this.window.navigator.clipboard.writeText(value).then(
      () => { if (this.current(generation, key)) this.copied.set(success); },
      () => { if (this.current(generation, key)) this.copied.set('No pudimos copiarlo. Selecciona el texto y cópialo manualmente.'); },
    );
  }
  private liveKey(): string { return `${this.scope()}:${this.tenantKey()}:${this.contextReady()}:${this.canRead()}:${this.canConfigure()}:${this.isOpen()}`; }
  private current(generation: number, key: string): boolean { return !this.destroyed && generation === this.generation && key === this.liveKey(); }
  private mayRead(): boolean { return this.browser && !this.destroyed && this.isOpen() && this.scope() === 'store' && this.contextReady() && !!this.tenantKey() && this.canRead() && this.document.visibilityState === 'visible' && this.window?.navigator.onLine !== false; }
  private schedule(): void {
    if (!this.mayRead() || this.busy()) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.refresh(); }, Math.min(300_000, 30_000 * 2 ** Math.min(this.failures, 4)));
  }
  private expireCode(): void {
    this.clearCodeTimer();
    const expiry = this.gmailCode()?.expires_at;
    if (!expiry) return;
    const delay = Date.parse(expiry) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) { this.gmailCode.set(null); this.codeExpired.set(true); return; }
    this.codeExpired.set(false);
    const generation = this.generation; const key = this.liveKey();
    this.expiryTimer = setTimeout(() => { if (this.current(generation, key)) { this.gmailCode.set(null); this.codeExpired.set(true); this.now.set(Date.now()); } }, delay);
  }
  private clearPollTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private clearCodeTimer(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }
  private clearTimers(): void {
    this.clearPollTimer(); this.clearCodeTimer();
  }
  private invalidate(): void {
    this.generation++; this.clearTimers(); this.activeRequest?.unsubscribe(); this.mutationRequest?.unsubscribe();
    this.inFlight = false; this.followup = false; this.failures = 0; this.announced = false;
    this.snapshotKey.set(''); this.loading.set(false); this.busy.set(false); this.status.set(null); this.configuration.set(null); this.gmailCode.set(null);
    this.latestProblem.set(null); this.error.set(null); this.mutationError.set(null); this.copied.set(null); this.codeExpired.set(false);
    this.addressControl.setValue(''); this.consentControl.setValue(false);
  }
}
