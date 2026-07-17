import {
  DOCUMENT,
  EnvironmentInjector,
  Injectable,
  Renderer2,
  RendererFactory2,
  Signal,
  Type,
  createComponent,
  inject,
  signal,
} from '@angular/core';
import { AppNotification } from '../../../../../../core/store/notifications/notifications.actions';

/**
 * QR-mesa `require_staff` approval bridge (Step 10).
 *
 * The notifications.effects pipeline (NgRx) cannot render DOM directly,
 * so we use this service as the bridge between:
 *  - the effect that filters `type === 'qr_table_scan'` and calls
 *    `show(notification)`, and
 *  - the standalone `StaffScanApprovalModalComponent` rendered on
 *    `document.body`.
 *
 * Why self-mount instead of a layout outlet?
 *  The Step 10 scope forbids editing the store-admin layout. The
 *  modal must surface globally (the bell fires regardless of which
 *  route the mesero is on). Programmatically mounting to
 *  `document.body` keeps the layout untouched and matches the
 *  pattern used by `CameraComponent.mobileOverlay`.
 *
 * Concurrency contract:
 *  - Only ONE modal at a time. Calling `show()` REPLACES the
 *    payload — the latest scan wins (most relevant for the mesero).
 *  - `close()` clears the signal AND destroys the DOM mount.
 *  - The modal also dispatches a `staff-scan-approval:close`
 *    CustomEvent from inside its own Approve/Cancel buttons so the
 *    service can tear down without exposing the modal back to it.
 */
@Injectable({ providedIn: 'root' })
export class StaffScanApprovalService {
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly doc = inject(DOCUMENT);
  private readonly rendererFactory = inject(RendererFactory2);
  private readonly renderer: Renderer2 = this.rendererFactory.createRenderer(
    null,
    null,
  );

  /** Latest `qr_table_scan` notification — drives the modal's `isOpen` binding. */
  private readonly currentSignal = signal<AppNotification | null>(null);
  /** Mirror for the modal's `[isOpen]` input (1 = open, 0/null = closed). */
  private readonly openSignal = signal<boolean>(false);

  /** Read-only current notification — for any future consumer (debug, analytics). */
  readonly current: Signal<AppNotification | null> = this.currentSignal.asReadonly();

  /**
   * Lazy-loaded modal component reference — kept here so we don't pay
   * the dynamic-import cost until the first scan comes in.
   */
  private modalComponentRef: import('@angular/core').ComponentRef<unknown> | null =
    null;
  private hostElement: HTMLElement | null = null;
  private listenerTeardown?: () => void;

  /**
   * Open the modal for a given notification. The modal is mounted the
   * first time only; subsequent calls just update the inputs.
   */
  show(notification: AppNotification): void {
    this.currentSignal.set(notification);
    if (!this.openSignal()) {
      this.openSignal.set(true);
    }
    this.ensureModalMounted();
  }

  /** Close the modal explicitly — used by the listener on cancel/approve. */
  close(): void {
    this.openSignal.set(false);
  }

  /**
   * Internal effect-style teardown — runs when `openSignal` flips to
   * false after being true. We use a manual subscribe instead of
   * `effect()` to keep the service stateless across mounts (services
   * are `providedIn: 'root'` so the effect would run once anyway, but
   * this is explicit and zoneless-safe).
   */
  private ensureModalMounted(): void {
    if (this.modalComponentRef) {
      // Already mounted — Angular's signal input updates refresh the view.
      return;
    }
    if (typeof window === 'undefined') return; // SSR guard

    // Lazily import the standalone component to keep the service
    // bundle-friendly. The component is tiny so the import is cheap.
    void this.loadModalComponent().then((Cmp) => {
      if (this.modalComponentRef) return; // raced

      // Append a host element directly to <body>. Using a plain
      // div lets us hand the host over to Angular's createComponent
      // without needing a CDK overlay.
      const host = this.renderer.createElement('div') as HTMLElement;
      this.renderer.setAttribute(host, 'data-staff-scan-modal-host', '');
      this.renderer.appendChild(this.doc.body, host);
      this.hostElement = host;

      // Wire the close listener BEFORE creating the component so the
      // first modal mount can already teardown if it fires.
      this.attachCloseListener();

      // createComponent needs a DOM node. Pass `host` as the anchor.
      this.modalComponentRef = createComponent(Cmp, {
        hostElement: host,
        environmentInjector: this.envInjector,
      });

      // Wire the bindings: current notification + isOpen.
      this.modalComponentRef.setInput('notification', this.currentSignal());
      this.modalComponentRef.setInput('isOpen', this.openSignal());

      // Auto-detect changes inside the new component (OnPush).
      this.modalComponentRef.changeDetectorRef.detectChanges();
    });
  }

  private attachCloseListener(): void {
    if (this.listenerTeardown) return;
    const handler = () => {
      this.openSignal.set(false);
      this.teardownModal();
    };
    this.listenerTeardown = this.renderer.listen(
      this.doc,
      'staff-scan-approval:close',
      handler,
    );
  }

  /**
   * Tear down the modal: destroy the component ref, remove the host
   * element, and detach the close listener. Safe to call multiple times.
   */
  private teardownModal(): void {
    if (this.modalComponentRef) {
      try {
        this.modalComponentRef.destroy();
      } catch {
        // ignore — already destroyed
      }
      this.modalComponentRef = null;
    }
    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
      this.hostElement = null;
    }
    if (this.listenerTeardown) {
      this.listenerTeardown();
      this.listenerTeardown = undefined;
    }
    this.currentSignal.set(null);
  }

  /**
   * Lazy ESM import of the standalone modal component. We keep this
   * inside the service so other consumers don't pay the bundle cost
   * unless they trigger a `qr_table_scan` flow.
   */
  private async loadModalComponent(): Promise<Type<unknown>> {
    const mod = await import(
      '../components/staff-scan-approval-modal/staff-scan-approval-modal.component'
    );
    return mod.StaffScanApprovalModalComponent as Type<unknown>;
  }
}
