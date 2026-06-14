import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, fromEvent } from 'rxjs';

import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';

/**
 * HID barcode-scanner capture service for the POS frontend.
 *
 * A USB/Bluetooth barcode scanner behaves as a keyboard-wedge: it "types" the
 * code's characters at high speed followed by an Enter suffix. This service
 * listens to a single global `document` keydown stream and distinguishes a
 * scanner burst from human typing purely by timing, then emits the captured
 * code string to consumers (POS, product-edit, etc.).
 *
 * Scope: capture + emit ONLY. No product lookup, no cart, no toasts. Consumers
 * subscribe to `scans$` (or read the `lastScan` signal) and own all business
 * logic. Capture is fully gated behind the `barcode_scanner.enabled` store
 * setting via the `enabled` signal.
 *
 * Zoneless/signals: state read elsewhere is signal-based; the keydown stream is
 * managed with `takeUntilDestroyed`. As a `providedIn: 'root'` service it lives
 * for the app lifetime, so its `DestroyRef` ties the listener to that lifetime.
 */
@Injectable({ providedIn: 'root' })
export class PosBarcodeService {
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Max gap (ms) between two keystrokes that still counts as part of the same
   * scanner burst. A scanner emits keys <~30ms apart; a human types >~100ms
   * apart. ~50ms cleanly separates the two without clipping slower scanners.
   */
  private static readonly INTER_KEY_THRESHOLD_MS = 50;

  /** Minimum buffered length for an Enter to count as a real scan (filters stray keys). */
  private static readonly MIN_CODE_LENGTH = 3;

  /** Accumulated characters of the in-progress burst. */
  private buffer = '';

  /** `event.timeStamp` of the previous keystroke (DOMHighResTimeStamp). */
  private lastKeyTime = 0;

  /** Emits each completed scan (the full code string). */
  private readonly scansSubject = new Subject<string>();

  /** Last completed scan, for synchronous signal reads. */
  private readonly lastScanSignal = signal<string | null>(null);

  /** Stream of completed scans. Consumers subscribe to react to a scan. */
  readonly scans$ = this.scansSubject.asObservable();

  /** Last completed scan as a read-only signal. */
  readonly lastScan = this.lastScanSignal.asReadonly();

  /** Whether barcode-scanner capture is active, driven by the store setting. */
  readonly enabled = computed(
    () => this.settingsFacade.pos()?.barcode_scanner?.enabled ?? false,
  );

  constructor() {
    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.handleKeydown(event));
  }

  private handleKeydown(event: KeyboardEvent): void {
    // Gate: do nothing unless capture is enabled by the store setting.
    if (!this.enabled()) {
      return;
    }

    // Large gap since the previous key => human typing; start a fresh burst.
    if (event.timeStamp - this.lastKeyTime > PosBarcodeService.INTER_KEY_THRESHOLD_MS) {
      this.buffer = '';
    }
    this.lastKeyTime = event.timeStamp;

    if (event.key === 'Enter') {
      if (this.buffer.length > PosBarcodeService.MIN_CODE_LENGTH) {
        const code = this.buffer;
        // Only the terminating Enter is suppressed, so a buffered scan does not
        // trigger a form submit. Printable keystrokes are never preventDefault'd.
        event.preventDefault();
        this.lastScanSignal.set(code);
        this.scansSubject.next(code);
      }
      this.buffer = '';
      return;
    }

    // Printable single character: accumulate it into the current burst.
    if (event.key.length === 1) {
      this.buffer += event.key;
    }
  }
}
