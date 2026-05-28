import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  ViewChild,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  ToastService,
  CameraComponent,
} from '../../../../../shared/components';
import { ProductsService } from '../services/products.service';

type Stage = 'select' | 'url' | 'camera' | 'crop' | 'loading';
type ImageModalMode = 'add' | 'edit';
type AspectRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '4:5' | '9:16';

type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface PendingImage {
  dataUrl: string;
  fileName?: string;
}

interface CropFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  frameStart: CropFrame;
  pointerId: number;
  target: Element;
}

const ASPECT_RATIOS: {
  value: AspectRatio;
  label: string;
  ratio: number | null;
}[] = [
  { value: 'free', label: 'Libre', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
];

@Component({
  selector: 'app-product-image-source-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    CameraComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (closed)="onClose()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="lg"
    >
      @switch (stage()) {
        @case ('select') {
          <div class="space-y-4">
            @if (remainingSlots() <= 0) {
              <div
                class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center gap-2"
              >
                <app-icon name="alert-triangle" size="16"></app-icon>
                Límite de 5 imágenes alcanzado
              </div>
            } @else {
              <p class="text-sm text-text-secondary">
                Quedan {{ remainingSlots() }} espacio(s) disponible(s). Elige
                cómo quieres agregar imágenes:
              </p>
            }

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                (click)="pickFile()"
                [disabled]="remainingSlots() <= 0"
                class="p-4 border border-gray-200 rounded-xl text-left hover:border-primary-400 hover:bg-primary-50/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-3"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon name="upload-cloud" size="20"></app-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-900">Subir</p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    Selecciona archivos desde tu equipo
                  </p>
                </div>
              </button>

              <button
                type="button"
                (click)="goToUrl()"
                [disabled]="remainingSlots() <= 0"
                class="p-4 border border-gray-200 rounded-xl text-left hover:border-primary-400 hover:bg-primary-50/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-3"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon name="link" size="20"></app-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-900">Desde URL</p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    Descarga una imagen pública y edítala
                  </p>
                </div>
              </button>

              <button
                type="button"
                (click)="goToCamera()"
                [disabled]="remainingSlots() <= 0"
                class="p-4 border border-gray-200 rounded-xl text-left hover:border-primary-400 hover:bg-primary-50/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-3"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon name="camera" size="20"></app-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-900">Tomar foto</p>
                  <p class="text-xs text-gray-500 mt-0.5">
                    Usa la cámara del dispositivo
                  </p>
                </div>
              </button>

              <div
                class="p-4 border border-gray-200 rounded-xl bg-gray-50 flex items-start gap-3 opacity-70"
                title="Aún no disponible"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-gray-200 text-gray-500 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon name="search" size="20"></app-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-700">
                    Buscar en la web
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">Aún no disponible</p>
                </div>
              </div>

              <div
                class="p-4 border border-gray-200 rounded-xl bg-gray-50 flex items-start gap-3 opacity-70 sm:col-span-2"
                title="Aún no disponible"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-gray-200 text-gray-500 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon name="sparkles" size="20"></app-icon>
                </div>
                <div>
                  <p class="text-sm font-semibold text-gray-700">
                    Generar con IA
                  </p>
                  <p class="text-xs text-gray-500 mt-0.5">Aún no disponible</p>
                </div>
              </div>
            </div>

            <input
              #fileInput
              type="file"
              class="hidden"
              accept="image/*"
              multiple
              (change)="onFileSelect($event)"
            />
          </div>
        }

        @case ('url') {
          <div class="space-y-4">
            <button
              type="button"
              (click)="backToSelect()"
              class="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              <app-icon name="chevron-left" size="14"></app-icon>
              Volver
            </button>

            <app-input
              label="URL pública de la imagen"
              placeholder="https://..."
              [(ngModel)]="urlInput"
              [error]="urlError() ?? undefined"
              [disabled]="isFetchingUrl()"
            ></app-input>

            <p class="text-xs text-gray-500">
              Descargamos la imagen desde nuestro servidor para evitar bloqueos
              de origen y poder recortarla.
            </p>
          </div>
        }

        @case ('loading') {
          <div
            class="min-h-[220px] flex flex-col items-center justify-center text-center gap-3"
          >
            <div
              class="h-10 w-10 rounded-full border-2 border-primary-200 border-t-primary-600 animate-spin"
            ></div>
            <div>
              <p class="text-sm font-semibold text-gray-800">
                Preparando imagen
              </p>
              <p class="text-xs text-gray-500 mt-1">
                Cargando la foto seleccionada para editarla.
              </p>
            </div>
          </div>
        }

        @case ('camera') {
          <div class="space-y-4">
            <app-camera
              [isOpen]="stage() === 'camera'"
              [embedActions]="true"
              fileNamePrefix="foto"
              (captured)="onCameraCaptured($event)"
              (closed)="backToSelect()"
            ></app-camera>
          </div>
        }

        @case ('crop') {
          <div class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-gray-700"
                >Transformar:</span
              >
              <app-button
                variant="outline"
                size="sm"
                (clicked)="rotateBy(-90)"
                title="Rotar izquierda"
              >
                <app-icon slot="icon" name="rotate-ccw" size="14"></app-icon>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="rotateBy(90)"
                title="Rotar derecha"
              >
                <app-icon slot="icon" name="rotate-cw" size="14"></app-icon>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="toggleFlipH()"
                [class.bg-primary-600]="flipH()"
                [class.text-white]="flipH()"
                title="Voltear horizontal"
              >
                <app-icon
                  slot="icon"
                  name="flip-horizontal"
                  size="14"
                ></app-icon>
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                (clicked)="toggleFlipV()"
                [class.bg-primary-600]="flipV()"
                [class.text-white]="flipV()"
                title="Voltear vertical"
              >
                <app-icon slot="icon" name="flip-vertical" size="14"></app-icon>
              </app-button>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-gray-700"
                >Relación de aspecto:</span
              >
              @for (preset of aspectPresets; track preset.value) {
                <button
                  type="button"
                  (click)="setAspect(preset.value)"
                  [class.bg-primary-600]="aspect() === preset.value"
                  [class.text-white]="aspect() === preset.value"
                  [class.border-primary-600]="aspect() === preset.value"
                  class="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 text-gray-700 hover:border-primary-400 transition-colors"
                >
                  {{ preset.label }}
                </button>
              }
            </div>

            <div
              class="relative w-full bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center p-3"
              style="min-height: 280px;"
            >
              <div
                #cropWrapper
                class="relative inline-block max-w-full"
                style="touch-action: none;"
              >
                <canvas
                  #cropCanvas
                  class="max-w-full max-h-[60vh] block select-none"
                ></canvas>
                @if (cropFrame(); as f) {
                  <!-- Backdrop oscurecido fuera del marco (clipped al wrapper externo overflow-hidden) -->
                  <div
                    class="absolute pointer-events-none"
                    style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);"
                    [style.left]="framePct().left"
                    [style.top]="framePct().top"
                    [style.width]="framePct().width"
                    [style.height]="framePct().height"
                  ></div>

                  <!-- Marco interactivo -->
                  <div
                    class="absolute"
                    [style.left]="framePct().left"
                    [style.top]="framePct().top"
                    [style.width]="framePct().width"
                    [style.height]="framePct().height"
                  >
                    <!-- Borde -->
                    <div
                      class="absolute inset-0 border-2 border-white pointer-events-none"
                    ></div>
                    <!-- Líneas de regla de los tercios -->
                    <div class="absolute inset-0 pointer-events-none">
                      <div
                        class="absolute left-0 right-0 border-t border-white/40"
                        style="top: 33.333%"
                      ></div>
                      <div
                        class="absolute left-0 right-0 border-t border-white/40"
                        style="top: 66.666%"
                      ></div>
                      <div
                        class="absolute top-0 bottom-0 border-l border-white/40"
                        style="left: 33.333%"
                      ></div>
                      <div
                        class="absolute top-0 bottom-0 border-l border-white/40"
                        style="left: 66.666%"
                      ></div>
                    </div>

                    <!-- Área de movimiento -->
                    <div
                      class="absolute inset-0 cursor-move"
                      (pointerdown)="onPointerDown($event, 'move')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>

                    <!-- Handles: esquinas -->
                    <div
                      class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-nwse-resize"
                      (pointerdown)="onPointerDown($event, 'nw')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-nesw-resize"
                      (pointerdown)="onPointerDown($event, 'ne')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-nesw-resize"
                      (pointerdown)="onPointerDown($event, 'sw')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-nwse-resize"
                      (pointerdown)="onPointerDown($event, 'se')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>

                    <!-- Handles: bordes -->
                    <div
                      class="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-ns-resize"
                      (pointerdown)="onPointerDown($event, 'n')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-ns-resize"
                      (pointerdown)="onPointerDown($event, 's')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-ew-resize"
                      (pointerdown)="onPointerDown($event, 'w')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                    <div
                      class="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 bg-white border border-gray-700 rounded-sm cursor-ew-resize"
                      (pointerdown)="onPointerDown($event, 'e')"
                      (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp($event)"
                      (pointercancel)="onPointerUp($event)"
                      (lostpointercapture)="onLostCapture($event)"
                    ></div>
                  </div>
                }
              </div>
            </div>

            <div class="text-xs text-gray-500">
              Imagen {{ queueCursor() + 1 }} de {{ queue().length }} · Arrastra
              el marco para reposicionarlo y los puntos para redimensionarlo
            </div>
          </div>
        }
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        @switch (stage()) {
          @case ('select') {
            <app-button variant="outline" (clicked)="onClose()">
              <app-icon slot="icon" name="x" size="16"></app-icon>
              Cerrar
            </app-button>
          }

          @case ('loading') {
            <app-button variant="outline" (clicked)="onClose()">
              <app-icon slot="icon" name="x" size="16"></app-icon>
              Cancelar
            </app-button>
          }

          @case ('url') {
            <app-button
              variant="outline"
              (clicked)="backToSelect()"
              [disabled]="isFetchingUrl()"
            >
              <app-icon slot="icon" name="x" size="16"></app-icon>
              Cancelar
            </app-button>
            <app-button
              variant="primary"
              (clicked)="fetchUrl()"
              [loading]="isFetchingUrl()"
              [disabled]="!urlInput.trim() || isFetchingUrl()"
            >
              <app-icon slot="icon" name="download" size="16"></app-icon>
              Obtener imagen
            </app-button>
          }

          @case ('camera') {
            @if (!cameraRef()?.isMobile()) {
              <app-button variant="outline" (clicked)="backToSelect()">
                <app-icon slot="icon" name="x" size="16"></app-icon>
                Cancelar
              </app-button>
              <app-button
                variant="primary"
                (clicked)="cameraRef()?.capture()"
                [disabled]="!cameraRef()?.cameraReady()"
              >
                <app-icon slot="icon" name="camera" size="16"></app-icon>
                Capturar
              </app-button>
            }
          }

          @case ('crop') {
            <app-button variant="outline" (clicked)="resetFrame()">
              <app-icon slot="icon" name="rotate-ccw" size="16"></app-icon>
              Restablecer
            </app-button>
            @if (mode() === 'add') {
              <app-button variant="outline" (clicked)="skipCurrent()">
                <app-icon slot="icon" name="skip-forward" size="16"></app-icon>
                Omitir
              </app-button>
            }
            <app-button variant="outline" (clicked)="cancelCrop()">
              <app-icon slot="icon" name="x" size="16"></app-icon>
              Cancelar
            </app-button>
            <app-button variant="primary" (clicked)="applyCrop()">
              <app-icon slot="icon" name="check" size="16"></app-icon>
              {{ mode() === 'edit' ? 'Guardar ajuste' : 'Aplicar y agregar' }}
            </app-button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class ProductImageSourceModalComponent {
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly remainingSlots = input<number>(5);
  readonly mode = input<ImageModalMode>('add');
  readonly sourceImageUrl = input<string | null>(null);
  readonly imagesAdded = output<string[]>();
  readonly imageEdited = output<string>();

  readonly stage = signal<Stage>('select');
  readonly queue = signal<PendingImage[]>([]);
  readonly queueCursor = signal(0);
  readonly aspect = signal<AspectRatio>('free');

  urlInput = '';
  readonly urlError = signal<string | null>(null);
  readonly isFetchingUrl = signal(false);

  readonly rotation = signal<0 | 90 | 180 | 270>(0);
  readonly flipH = signal<boolean>(false);
  readonly flipV = signal<boolean>(false);
  readonly axesSwapped = computed(
    () => this.rotation() === 90 || this.rotation() === 270,
  );

  readonly cropFrame = signal<CropFrame | null>(null);
  readonly canvasSize = signal<{ w: number; h: number }>({ w: 0, h: 0 });

  private dragState: DragState | null = null;
  private readonly MIN_FRAME = 24;
  private lastStartedEditUrl: string | null = null;

  readonly modalTitle = computed(() => {
    switch (this.stage()) {
      case 'url':
        return 'Agregar desde URL';
      case 'camera':
        return 'Tomar foto';
      case 'crop':
        return this.mode() === 'edit'
          ? 'Ajustar y recortar'
          : 'Recortar imagen';
      case 'loading':
        return 'Preparando imagen';
      default:
        return 'Agregar imágenes';
    }
  });

  readonly modalSubtitle = computed(() => {
    if (this.mode() === 'edit') return 'Edita la foto seleccionada';
    if (this.stage() === 'select') return 'Elige una fuente';
    return undefined;
  });

  readonly aspectPresets = ASPECT_RATIOS;

  readonly framePct = computed(() => {
    const f = this.cropFrame();
    const c = this.canvasSize();
    if (!f || c.w === 0 || c.h === 0) {
      return { left: '0%', top: '0%', width: '0%', height: '0%' };
    }
    return {
      left: `${(f.x / c.w) * 100}%`,
      top: `${(f.y / c.h) * 100}%`,
      width: `${(f.w / c.w) * 100}%`,
      height: `${(f.h / c.h) * 100}%`,
    };
  });

  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('cropCanvas') cropCanvasRef?: ElementRef<HTMLCanvasElement>;
  readonly cameraRef = viewChild(CameraComponent);

  private loadedImages = new Map<number, HTMLImageElement>();

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      const mode = this.mode();
      const sourceUrl = this.sourceImageUrl();

      if (!isOpen || mode !== 'edit') {
        this.lastStartedEditUrl = null;
        return;
      }

      if (!sourceUrl || this.lastStartedEditUrl === sourceUrl) return;

      this.lastStartedEditUrl = sourceUrl;
      queueMicrotask(() => this.startEditFlow(sourceUrl));
    });
  }

  onClose(): void {
    this.stage.set('select');
    this.queue.set([]);
    this.queueCursor.set(0);
    this.aspect.set('free');
    this.rotation.set(0);
    this.flipH.set(false);
    this.flipV.set(false);
    this.cropFrame.set(null);
    this.canvasSize.set({ w: 0, h: 0 });
    this.urlInput = '';
    this.urlError.set(null);
    this.isFetchingUrl.set(false);
    this.loadedImages.clear();
    this.dragState = null;
    this.pendingResults = [];
    this.lastStartedEditUrl = null;
    this.isOpen.set(false);
  }

  backToSelect(): void {
    this.stage.set('select');
  }

  pickFile(): void {
    if (this.remainingSlots() <= 0) return;
    this.fileInputRef?.nativeElement.click();
  }

  async onFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    const remaining = this.remainingSlots();
    const filesArr = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, remaining);

    if (filesArr.length === 0) {
      this.toastService.warning('Selecciona archivos de imagen válidos');
      input.value = '';
      return;
    }

    const pending: PendingImage[] = [];
    for (const file of filesArr) {
      try {
        const dataUrl = await this.readAsDataURL(file);
        pending.push({ dataUrl, fileName: file.name });
      } catch (_err) {
        this.toastService.error(`Error al leer ${file.name}`);
      }
    }
    input.value = '';
    if (pending.length === 0) return;

    this.startCropFlow(pending);
  }

  goToUrl(): void {
    if (this.remainingSlots() <= 0) return;
    this.urlInput = '';
    this.urlError.set(null);
    this.stage.set('url');
  }

  fetchUrl(): void {
    const url = this.urlInput.trim();
    if (!url) return;

    this.urlError.set(null);
    this.isFetchingUrl.set(true);

    this.productsService
      .getRemoteImagePreview(url)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: {
          dataUrl: string;
          fileName: string;
          contentType: string;
          byteLength: number;
        }) => {
          this.isFetchingUrl.set(false);
          this.startCropFlow([
            { dataUrl: result.dataUrl, fileName: result.fileName },
          ]);
        },
        error: (err: any) => {
          this.isFetchingUrl.set(false);
          const message =
            typeof err === 'string'
              ? err
              : err?.error?.message || 'No pudimos descargar la imagen';
          this.urlError.set(message);
          this.toastService.error(message, 'URL inválida');
        },
      });
  }

  goToCamera(): void {
    if (this.remainingSlots() <= 0) return;
    this.stage.set('camera');
  }

  onCameraCaptured(payload: { dataUrl: string; fileName: string }): void {
    this.startCropFlow([payload]);
  }

  private startCropFlow(items: PendingImage[]): void {
    if (items.length === 0) return;
    this.queue.set(items);
    this.queueCursor.set(0);
    this.aspect.set('free');
    this.rotation.set(0);
    this.flipH.set(false);
    this.flipV.set(false);
    this.cropFrame.set(null);
    this.canvasSize.set({ w: 0, h: 0 });
    this.stage.set('crop');
    setTimeout(() => this.renderCropPreview(), 0);
  }

  private startEditFlow(sourceUrl: string): void {
    this.pendingResults = [];
    this.stage.set('loading');
    this.queue.set([]);
    this.queueCursor.set(0);
    this.aspect.set('free');
    this.rotation.set(0);
    this.flipH.set(false);
    this.flipV.set(false);
    this.cropFrame.set(null);
    this.canvasSize.set({ w: 0, h: 0 });
    this.loadedImages.clear();

    if (sourceUrl.startsWith('data:image') || sourceUrl.startsWith('blob:')) {
      this.startCropFlow([{ dataUrl: sourceUrl }]);
      return;
    }

    this.productsService
      .getRemoteImagePreview(sourceUrl)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: {
          dataUrl: string;
          fileName: string;
          contentType: string;
          byteLength: number;
        }) => {
          if (
            !this.isOpen() ||
            this.mode() !== 'edit' ||
            this.sourceImageUrl() !== sourceUrl
          ) {
            return;
          }

          this.startCropFlow([
            { dataUrl: result.dataUrl, fileName: result.fileName },
          ]);
        },
        error: () => {
          if (!this.isOpen()) return;
          this.toastService.error(
            'No pudimos preparar la imagen para editarla',
          );
          this.onClose();
        },
      });
  }

  setAspect(value: AspectRatio): void {
    this.dragState = null;
    this.aspect.set(value);
    this.resetFrameForCurrentAspect();
  }

  resetFrame(): void {
    this.dragState = null;
    this.resetFrameForCurrentAspect();
  }

  rotateBy(delta: 90 | -90): void {
    const next = ((((this.rotation() + delta) % 360) + 360) % 360) as
      | 0
      | 90
      | 180
      | 270;
    this.rotation.set(next);
    this.renderCropPreview();
  }

  toggleFlipH(): void {
    this.flipH.update((v) => !v);
    this.renderCropPreview();
  }

  toggleFlipV(): void {
    this.flipV.update((v) => !v);
    this.renderCropPreview();
  }

  private async renderCropPreview(): Promise<void> {
    const canvas = this.cropCanvasRef?.nativeElement;
    const item = this.queue()[this.queueCursor()];
    if (!canvas || !item) return;

    const img = await this.loadImage(this.queueCursor(), item.dataUrl);

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const drawW = Math.round(img.width * scale);
    const drawH = Math.round(img.height * scale);

    const swapped = this.axesSwapped();
    canvas.width = swapped ? drawH : drawW;
    canvas.height = swapped ? drawW : drawH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((this.rotation() * Math.PI) / 180);
    ctx.scale(this.flipH() ? -1 : 1, this.flipV() ? -1 : 1);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    this.canvasSize.set({ w: canvas.width, h: canvas.height });
    this.resetFrameForCurrentAspect();
  }

  private resetFrameForCurrentAspect(): void {
    const c = this.canvasSize();
    if (c.w === 0 || c.h === 0) return;
    const preset = ASPECT_RATIOS.find((p) => p.value === this.aspect());
    const ratio = preset?.ratio ?? null;

    let w: number;
    let h: number;
    if (ratio === null) {
      w = c.w * 0.8;
      h = c.h * 0.8;
    } else {
      const canvasRatio = c.w / c.h;
      if (canvasRatio > ratio) {
        h = c.h * 0.9;
        w = h * ratio;
      } else {
        w = c.w * 0.9;
        h = w / ratio;
      }
    }
    const x = (c.w - w) / 2;
    const y = (c.h - h) / 2;
    this.cropFrame.set({ x, y, w, h });
  }

  onPointerDown(ev: PointerEvent, mode: DragMode): void {
    const f = this.cropFrame();
    if (!f) return;
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as Element;
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      // safari fallback: ignorar
    }
    this.dragState = {
      mode,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      frameStart: { ...f },
      pointerId: ev.pointerId,
      target,
    };
  }

  onPointerMove(ev: PointerEvent): void {
    if (!this.dragState) return;
    if (ev.pointerId !== this.dragState.pointerId) return;
    // Salvavidas: si la captura se perdió (ventana sin focus, drag escapado),
    // ev.buttons === 0 indica que ya no hay botón presionado; abortar drag.
    if (ev.buttons === 0) {
      this.dragState = null;
      return;
    }
    const canvas = this.cropCanvasRef?.nativeElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    ev.preventDefault();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const dx = (ev.clientX - this.dragState.startClientX) * scaleX;
    const dy = (ev.clientY - this.dragState.startClientY) * scaleY;
    const next = this.computeFrameUpdate(
      this.dragState.mode,
      this.dragState.frameStart,
      dx,
      dy,
    );
    if (next) this.cropFrame.set(next);
  }

  onPointerUp(ev: PointerEvent): void {
    if (!this.dragState) return;
    if (ev.pointerId !== this.dragState.pointerId) return;
    try {
      this.dragState.target.releasePointerCapture(this.dragState.pointerId);
    } catch {
      // ignorar
    }
    this.dragState = null;
  }

  onLostCapture(ev: PointerEvent): void {
    if (this.dragState?.pointerId === ev.pointerId) {
      this.dragState = null;
    }
  }

  private computeFrameUpdate(
    mode: DragMode,
    start: CropFrame,
    dx: number,
    dy: number,
  ): CropFrame | null {
    const c = this.canvasSize();
    if (c.w === 0 || c.h === 0) return null;
    const preset = ASPECT_RATIOS.find((p) => p.value === this.aspect());
    const ratio = preset?.ratio ?? null;
    const min = this.MIN_FRAME;

    if (mode === 'move') {
      const x = Math.max(0, Math.min(c.w - start.w, start.x + dx));
      const y = Math.max(0, Math.min(c.h - start.h, start.y + dy));
      return { x, y, w: start.w, h: start.h };
    }

    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (mode === 'n' || mode === 'nw' || mode === 'ne') top = start.y + dy;
    if (mode === 's' || mode === 'sw' || mode === 'se')
      bottom = start.y + start.h + dy;
    if (mode === 'w' || mode === 'nw' || mode === 'sw') left = start.x + dx;
    if (mode === 'e' || mode === 'ne' || mode === 'se')
      right = start.x + start.w + dx;

    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(c.w, right);
    bottom = Math.min(c.h, bottom);

    if (right - left < min) {
      if (mode === 'w' || mode === 'nw' || mode === 'sw') {
        left = right - min;
      } else {
        right = left + min;
      }
    }
    if (bottom - top < min) {
      if (mode === 'n' || mode === 'nw' || mode === 'ne') {
        top = bottom - min;
      } else {
        bottom = top + min;
      }
    }

    if (ratio !== null) {
      const adjusted = this.lockRatio(
        mode,
        start,
        left,
        top,
        right,
        bottom,
        ratio,
        c,
      );
      if (!adjusted) return null;
      left = adjusted.left;
      top = adjusted.top;
      right = adjusted.right;
      bottom = adjusted.bottom;
    }

    const w = right - left;
    const h = bottom - top;
    if (w < min || h < min) return null;

    return { x: left, y: top, w, h };
  }

  private lockRatio(
    mode: DragMode,
    start: CropFrame,
    left: number,
    top: number,
    right: number,
    bottom: number,
    ratio: number,
    c: { w: number; h: number },
  ): { left: number; top: number; right: number; bottom: number } | null {
    let newW = right - left;
    let newH = bottom - top;

    let driver: 'w' | 'h';
    if (mode === 'n' || mode === 's') driver = 'h';
    else if (mode === 'e' || mode === 'w') driver = 'w';
    else {
      const rW = Math.abs(newW - start.w) / Math.max(1, start.w);
      const rH = Math.abs(newH - start.h) / Math.max(1, start.h);
      driver = rW >= rH ? 'w' : 'h';
    }

    if (driver === 'w') {
      newH = newW / ratio;
      if (mode === 'n' || mode === 'nw' || mode === 'ne') {
        top = bottom - newH;
      } else {
        bottom = top + newH;
      }
    } else {
      newW = newH * ratio;
      if (mode === 'w' || mode === 'nw' || mode === 'sw') {
        left = right - newW;
      } else {
        right = left + newW;
      }
    }

    if (left < 0) {
      const shift = -left;
      left = 0;
      newW = right - left;
      newH = newW / ratio;
      if (mode === 'n' || mode === 'nw' || mode === 'ne') top = bottom - newH;
      else bottom = top + newH;
    }
    if (top < 0) {
      top = 0;
      newH = bottom - top;
      newW = newH * ratio;
      if (mode === 'w' || mode === 'nw' || mode === 'sw') left = right - newW;
      else right = left + newW;
    }
    if (right > c.w) {
      right = c.w;
      newW = right - left;
      newH = newW / ratio;
      if (mode === 'n' || mode === 'nw' || mode === 'ne') top = bottom - newH;
      else bottom = top + newH;
    }
    if (bottom > c.h) {
      bottom = c.h;
      newH = bottom - top;
      newW = newH * ratio;
      if (mode === 'w' || mode === 'nw' || mode === 'sw') left = right - newW;
      else right = left + newW;
    }

    if (left < 0 || top < 0 || right > c.w + 0.5 || bottom > c.h + 0.5) {
      return null;
    }
    if (right - left < this.MIN_FRAME || bottom - top < this.MIN_FRAME) {
      return null;
    }

    return { left, top, right, bottom };
  }

  private loadImage(
    cursor: number,
    dataUrl: string,
  ): Promise<HTMLImageElement> {
    const cached = this.loadedImages.get(cursor);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.loadedImages.set(cursor, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = dataUrl;
    });
  }

  async applyCrop(): Promise<void> {
    const item = this.queue()[this.queueCursor()];
    const f = this.cropFrame();
    const canvas = this.cropCanvasRef?.nativeElement;
    if (!item || !f || !canvas) return;

    const img = await this.loadImage(this.queueCursor(), item.dataUrl);
    const swapped = this.axesSwapped();

    const MAX_OUT = 4096;
    const srcScale = Math.min(1, MAX_OUT / Math.max(img.width, img.height));
    const baseW = Math.round(img.width * srcScale);
    const baseH = Math.round(img.height * srcScale);
    const fullW = swapped ? baseH : baseW;
    const fullH = swapped ? baseW : baseH;

    const tmp = document.createElement('canvas');
    tmp.width = fullW;
    tmp.height = fullH;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.save();
    tctx.translate(fullW / 2, fullH / 2);
    tctx.rotate((this.rotation() * Math.PI) / 180);
    tctx.scale(this.flipH() ? -1 : 1, this.flipV() ? -1 : 1);
    tctx.drawImage(img, -baseW / 2, -baseH / 2, baseW, baseH);
    tctx.restore();

    const scaleX = fullW / canvas.width;
    const scaleY = fullH / canvas.height;
    let sx = Math.max(0, Math.round(f.x * scaleX));
    let sy = Math.max(0, Math.round(f.y * scaleY));
    let sw = Math.max(1, Math.round(f.w * scaleX));
    let sh = Math.max(1, Math.round(f.h * scaleY));
    sw = Math.min(sw, fullW - sx);
    sh = Math.min(sh, fullH - sy);

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.drawImage(tmp, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = out.toDataURL('image/jpeg', 0.9);

    if (this.mode() === 'edit') {
      this.imageEdited.emit(dataUrl);
      this.onClose();
      return;
    }

    this.appendResult(dataUrl);
    this.advanceQueue();
  }

  skipCurrent(): void {
    this.advanceQueue();
  }

  cancelCrop(): void {
    if (this.mode() === 'edit') {
      this.onClose();
      return;
    }

    this.queue.set([]);
    this.queueCursor.set(0);
    this.rotation.set(0);
    this.flipH.set(false);
    this.flipV.set(false);
    this.cropFrame.set(null);
    this.canvasSize.set({ w: 0, h: 0 });
    this.loadedImages.clear();
    this.pendingResults = [];
    this.stage.set('select');
  }

  private pendingResults: string[] = [];

  private appendResult(dataUrl: string): void {
    this.pendingResults.push(dataUrl);
  }

  private advanceQueue(): void {
    const next = this.queueCursor() + 1;
    if (next >= this.queue().length) {
      const results = this.pendingResults.slice();
      this.pendingResults = [];
      if (results.length > 0) {
        this.imagesAdded.emit(results);
      }
      this.onClose();
      return;
    }
    this.queueCursor.set(next);
    this.aspect.set('free');
    this.rotation.set(0);
    this.flipH.set(false);
    this.flipV.set(false);
    this.cropFrame.set(null);
    this.canvasSize.set({ w: 0, h: 0 });
    setTimeout(() => this.renderCropPreview(), 0);
  }

  private readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === 'string') resolve(result);
        else reject(new Error('Resultado inválido'));
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error('Error de lectura'));
      reader.readAsDataURL(file);
    });
  }
}
