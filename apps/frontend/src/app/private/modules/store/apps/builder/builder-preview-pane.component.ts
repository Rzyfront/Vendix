import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  BUILDER_DEVICE_WIDTH,
  BUILDER_PREVIEW_CHANNEL,
  BuilderPreviewRender,
  previewScale,
  readHostMessage,
} from './builder-preview';
import type { BuilderDevice } from './builder.types';

/**
 * F6-A — the live preview pane of the page builder (engine, app-agnostic).
 *
 * Hosts the app's preview frame route (`frameSrc`) at the real width of the
 * chosen device and scales it down to fit the pane, so breakpoints behave as
 * on a real phone or desktop. Every change of `payload` reaches the frame
 * immediately; a click on a section in the frame comes back as `blockSelect`.
 */
@Component({
  selector: 'app-builder-preview-pane',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-h-0 flex-col" data-testid="builder-preview">
      <div class="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div class="inline-flex rounded-lg border border-[var(--color-border)] p-0.5" role="radiogroup" aria-label="Dispositivo de la vista previa">
          @for (d of devices; track d.id) {
            <button type="button" role="radio" [attr.aria-checked]="device() === d.id" [attr.data-device]="d.id"
                    class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                    [class]="device() === d.id
                      ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary,#fff)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'"
                    (click)="device.set(d.id)">
              <app-icon [name]="d.icon" [size]="14" />
              {{ d.label }}
            </button>
          }
        </div>
        <span class="text-[11px] tabular-nums text-[var(--color-text-secondary)]">
          {{ deviceWidth() }} px · {{ scalePercent() }} %
        </span>
      </div>

      <div #viewport class="relative min-h-0 flex-1 overflow-hidden bg-[var(--color-background)]">
        <div class="absolute top-3 overflow-hidden border border-[var(--color-border)] bg-white shadow-lg"
             style="left: 50%; transform-origin: top center;"
             [style.width.px]="deviceWidth()"
             [style.height.px]="frameHeight()"
             [style.transform]="'translateX(-50%) scale(' + scale() + ')'"
             [style.border-radius.px]="device() === 'mobile' ? 28 : 10">
          <iframe #frame [src]="safeSrc()" title="Vista previa de la página" class="block h-full w-full border-0"></iframe>
        </div>
        @if (!ready()) {
          <div class="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <app-icon name="loader" [size]="16" [spin]="true" />
            Preparando la vista previa…
          </div>
        }
      </div>
    </div>
  `,
})
export class BuilderPreviewPaneComponent<TPayload = unknown> {
  private readonly sanitizer = inject(DomSanitizer);

  /** Same-origin route of the app's preview frame (e.g. `/admin/apps/landing/preview-frame`). */
  readonly frameSrc = input.required<string>();
  readonly payload = input.required<TPayload>();
  readonly selectedBlockId = input<string | null>(null);
  readonly device = model<BuilderDevice>('mobile');
  readonly blockSelect = output<string>();

  readonly devices: readonly { id: BuilderDevice; label: string; icon: string }[] = [
    { id: 'mobile', label: 'Móvil', icon: 'smartphone' },
    { id: 'desktop', label: 'Escritorio', icon: 'monitor' },
  ];

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');

  readonly ready = signal(false);
  private readonly paneSize = signal({ width: 0, height: 0 });

  readonly safeSrc = computed(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.frameSrc()));
  readonly deviceWidth = computed(() => BUILDER_DEVICE_WIDTH[this.device()]);
  /** 24 px of breathing room around the device. */
  readonly scale = computed(() => previewScale(this.paneSize().width - 24, this.deviceWidth()));
  readonly scalePercent = computed(() => Math.round(this.scale() * 100));
  /** The frame fills the pane height once scaled. */
  readonly frameHeight = computed(() => Math.max(320, (this.paneSize().height - 24) / this.scale()));

  constructor() {
    const destroyRef = inject(DestroyRef);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== this.frame().nativeElement.contentWindow) return;
      const message = readHostMessage(event, window.location.origin);
      if (!message) return;
      if (message.type === 'ready') {
        this.ready.set(true);
        this.post();
      } else {
        this.blockSelect.emit(message.blockId);
      }
    };
    window.addEventListener('message', onMessage);
    destroyRef.onDestroy(() => window.removeEventListener('message', onMessage));

    effect((onCleanup) => {
      const element = this.viewport().nativeElement;
      const observer = new ResizeObserver(([entry]) => {
        this.paneSize.set({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    // Every draft change reaches the frame right away.
    effect(() => {
      this.payload();
      this.selectedBlockId();
      if (this.ready()) this.post();
    });
  }

  private post(): void {
    const target = this.frame().nativeElement.contentWindow;
    if (!target) return;
    const message: BuilderPreviewRender<TPayload> = {
      channel: BUILDER_PREVIEW_CHANNEL,
      type: 'render',
      payload: this.payload(),
      selectedBlockId: this.selectedBlockId(),
    };
    target.postMessage(message, window.location.origin);
  }
}
