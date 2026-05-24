import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  EmptyStateComponent,
  InputButtonsComponent,
  InputButtonOption,
  InputComponent,
  TextareaComponent,
} from '../../../../../../shared/components';
import { AdCreativeFormat } from '../anuncios.interface';

type TextPosition = 'top' | 'center' | 'bottom';
type TextAlign = 'left' | 'center' | 'right';

interface ManualEditorControls {
  text: FormControl<string>;
  textColor: FormControl<string>;
  fontSize: FormControl<number>;
  overlay: FormControl<number>;
  position: FormControl<TextPosition>;
  align: FormControl<TextAlign>;
}

@Component({
  selector: 'app-manual-ad-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AlertBannerComponent,
    EmptyStateComponent,
    InputButtonsComponent,
    InputComponent,
    TextareaComponent,
  ],
  template: `
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div
        class="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
      >
        @if (imageUrl()) {
          <div
            class="flex max-h-[72vh] w-full max-w-[760px] items-center justify-center"
            [ngClass]="previewAspectClass()"
          >
            <canvas
              #canvasRef
              class="h-full w-full rounded-md object-contain shadow-sm"
              aria-label="Lienzo de edicion manual"
            ></canvas>
          </div>
        } @else {
          <app-empty-state
            size="sm"
            icon="image"
            title="Selecciona una imagen"
            description="Elige una imagen de la galeria para editarla manualmente."
            [showActionButton]="false"
          ></app-empty-state>
        }
      </div>

      <form [formGroup]="form" class="space-y-4">
        <app-textarea
          formControlName="text"
          label="Texto"
          placeholder="Promo de temporada"
          [rows]="4"
        ></app-textarea>

        <div class="grid grid-cols-2 gap-3">
          <app-input
            formControlName="textColor"
            label="Color"
            type="color"
            size="md"
          ></app-input>

          <app-input
            formControlName="fontSize"
            label="Tamano"
            type="number"
            [min]="32"
            [max]="180"
            size="md"
          ></app-input>
        </div>

        <app-input
          formControlName="overlay"
          label="Contraste"
          type="number"
          [min]="0"
          [max]="70"
          helperText="0 a 70"
          size="md"
        ></app-input>

        <div class="grid grid-cols-2 gap-3">
          <app-input-buttons
            formControlName="position"
            label="Posicion"
            [options]="positionOptions"
            [hideLabelsOnMobile]="true"
          ></app-input-buttons>

          <app-input-buttons
            formControlName="align"
            label="Alineacion"
            [options]="alignOptions"
            [hideLabelsOnMobile]="true"
          ></app-input-buttons>
        </div>
      </form>
    </div>

    @if (renderError()) {
      <app-alert-banner
        class="mt-4 block"
        variant="danger"
        icon="triangle-alert"
      >
        {{ renderError() }}
      </app-alert-banner>
    }
  `,
})
export class ManualAdEditorComponent implements AfterViewInit {
  readonly imageUrl = input<string | null>(null);
  readonly format = input<AdCreativeFormat>('square');

  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('canvasRef');
  private renderVersion = 0;

  protected readonly positionOptions: InputButtonOption[] = [
    { value: 'top', label: 'Arriba', icon: 'arrow-up-circle' },
    { value: 'center', label: 'Centro', icon: 'circle' },
    { value: 'bottom', label: 'Abajo', icon: 'arrow-down-circle' },
  ];
  protected readonly alignOptions: InputButtonOption[] = [
    { value: 'left', label: 'Izq.', icon: 'align-left' },
    { value: 'center', label: 'Centro', icon: 'align-center' },
    { value: 'right', label: 'Der.', icon: 'align-right' },
  ];
  protected readonly renderError = signal<string | null>(null);
  protected readonly form = new FormGroup<ManualEditorControls>({
    text: new FormControl('', { nonNullable: true }),
    textColor: new FormControl('#ffffff', { nonNullable: true }),
    fontSize: new FormControl(92, { nonNullable: true }),
    overlay: new FormControl(28, { nonNullable: true }),
    position: new FormControl<TextPosition>('bottom', { nonNullable: true }),
    align: new FormControl<TextAlign>('center', { nonNullable: true }),
  });

  protected readonly previewAspectClass = computed(() => {
    const classes: Record<AdCreativeFormat, string> = {
      square: 'aspect-square',
      story: 'aspect-[9/16]',
      landscape: 'aspect-[16/9]',
    };
    return classes[this.format()];
  });

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.render());

    effect(() => {
      this.imageUrl();
      this.format();
      queueMicrotask(() => void this.render());
    });
  }

  ngAfterViewInit(): void {
    void this.render();
  }

  exportImage(): string | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.imageUrl()) {
      this.renderError.set('Selecciona una imagen antes de exportar.');
      return null;
    }

    try {
      return canvas.toDataURL('image/png');
    } catch {
      this.renderError.set(
        'No se pudo exportar la imagen. Revisa que el origen permita edicion.',
      );
      return null;
    }
  }

  private async render(): Promise<void> {
    const canvas = this.canvasRef()?.nativeElement;
    const imageUrl = this.imageUrl();
    if (!canvas || !imageUrl) return;

    const version = ++this.renderVersion;
    const dimensions = this.formatDimensions(this.format());
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f3f4f6';
    context.fillRect(0, 0, canvas.width, canvas.height);

    try {
      const image = await this.loadImage(imageUrl);
      if (version !== this.renderVersion) return;

      this.drawCover(context, image, canvas.width, canvas.height);
      this.drawOverlay(context, canvas.width, canvas.height);
      this.drawText(context, canvas.width, canvas.height);
      this.renderError.set(null);
    } catch {
      if (version !== this.renderVersion) return;
      this.renderError.set('No se pudo cargar la imagen seleccionada.');
      this.drawText(context, canvas.width, canvas.height);
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image load failed'));
      image.src = src;
    });
  }

  private drawCover(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    width: number,
    height: number,
  ): void {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (width - drawWidth) / 2;
    const y = (height - drawHeight) / 2;
    context.drawImage(image, x, y, drawWidth, drawHeight);
  }

  private drawOverlay(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const overlay = Math.max(0, Math.min(70, this.form.controls.overlay.value));
    if (!overlay) return;

    context.fillStyle = `rgba(0, 0, 0, ${overlay / 100})`;
    context.fillRect(0, 0, width, height);
  }

  private drawText(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    const text = this.form.controls.text.value.trim();
    if (!text) return;

    const fontSize = Math.max(
      32,
      Math.min(180, this.form.controls.fontSize.value),
    );
    const padding = width * 0.08;
    const maxWidth = width - padding * 2;
    const lineHeight = fontSize * 1.14;
    const lines = this.wrapText(context, text, maxWidth, fontSize);
    const totalHeight = lines.length * lineHeight;
    const position = this.form.controls.position.value;
    const align = this.form.controls.align.value;
    const x =
      align === 'left'
        ? padding
        : align === 'right'
          ? width - padding
          : width / 2;
    const y =
      position === 'top'
        ? padding + fontSize
        : position === 'center'
          ? (height - totalHeight) / 2 + fontSize
          : height - padding - totalHeight + fontSize;

    context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
    context.textAlign = align;
    context.textBaseline = 'alphabetic';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    context.lineWidth = Math.max(8, fontSize * 0.12);
    context.fillStyle = this.form.controls.textColor.value;

    lines.forEach((line, index) => {
      const lineY = y + index * lineHeight;
      context.strokeText(line, x, lineY);
      context.fillText(line, x, lineY);
    });
  }

  private wrapText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    fontSize: number,
  ): string[] {
    context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      if (context.measureText(testLine).width <= maxWidth || !line) {
        line = testLine;
        continue;
      }

      lines.push(line);
      line = word;
    }

    if (line) lines.push(line);
    return lines.slice(0, 5);
  }

  private formatDimensions(format: AdCreativeFormat): {
    width: number;
    height: number;
  } {
    const dimensions: Record<
      AdCreativeFormat,
      { width: number; height: number }
    > = {
      square: { width: 1080, height: 1080 },
      story: { width: 1080, height: 1920 },
      landscape: { width: 1600, height: 900 },
    };
    return dimensions[format];
  }
}
