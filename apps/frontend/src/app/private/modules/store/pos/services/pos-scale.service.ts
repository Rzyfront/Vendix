import {
  Injectable,
  OnDestroy,
  EnvironmentInjector,
  ApplicationRef,
  createComponent,
} from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  ScaleDeviceConfig,
  ScaleConnectionStatus,
} from '../../../../../core/models/store-settings.interface';
import { PosScaleWeightModalComponent } from '../components/pos-scale-weight-modal.component';

export interface ScaleWeightData {
  title: string;
  message: string;
  weightUnit: string;
  allowManualFallback: boolean;
}

const DEFAULT_CONFIG: ScaleDeviceConfig = {
  baud_rate: 9600,
  data_bits: 8,
  stop_bits: 1,
  parity: 'none',
  protocol: 'generic',
};

const STABILITY_TOLERANCE = 0.002;
const STABILITY_READINGS = 3;

@Injectable({ providedIn: 'root' })
export class PosScaleService implements OnDestroy {
  readonly weight$ = new BehaviorSubject<number>(0);
  readonly status$ = new BehaviorSubject<ScaleConnectionStatus>('disconnected');
  readonly stable$ = new BehaviorSubject<boolean>(false);

  private config: ScaleDeviceConfig = { ...DEFAULT_CONFIG };
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readLoopAbortController: AbortController | null = null;
  private recentReadings: number[] = [];

  constructor(
    private injector: EnvironmentInjector,
    private appRef: ApplicationRef,
  ) {}

  isWebSerialSupported(): boolean {
    return 'serial' in navigator;
  }

  configure(config: Partial<ScaleDeviceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async connect(): Promise<boolean> {
    if (!this.isWebSerialSupported()) return false;
    if (this.port) await this.disconnect();

    this.status$.next('connecting');

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({
        baudRate: this.config.baud_rate,
        dataBits: this.config.data_bits,
        stopBits: this.config.stop_bits,
        parity: this.config.parity,
      });

      this.status$.next('connected');
      this.startReadLoop();
      return true;
    } catch (err) {
      this.status$.next(err instanceof DOMException && err.name === 'NotFoundError' ? 'disconnected' : 'error');
      this.port = null;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.readLoopAbortController?.abort();
    this.readLoopAbortController = null;

    try {
      await this.reader?.cancel();
    } catch {
      // reader may already be closed
    }
    this.reader = null;

    try {
      await this.port?.close();
    } catch {
      // port may already be closed
    }
    this.port = null;

    this.weight$.next(0);
    this.stable$.next(false);
    this.recentReadings = [];
    this.status$.next('disconnected');
  }

  isConnected(): boolean {
    return this.status$.value === 'connected';
  }

  getCurrentWeight(): number {
    return this.weight$.value;
  }

  async tryAutoReconnect(): Promise<void> {
    if (!this.isWebSerialSupported()) return;

    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        this.port = ports[0];
        this.status$.next('connecting');

        await this.port.open({
          baudRate: this.config.baud_rate,
          dataBits: this.config.data_bits,
          stopBits: this.config.stop_bits,
          parity: this.config.parity,
        });

        this.status$.next('connected');
        this.startReadLoop();
      }
    } catch {
      this.port = null;
      this.status$.next('disconnected');
    }
  }

  showWeightModal(data: ScaleWeightData): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
      const componentRef = createComponent(PosScaleWeightModalComponent, {
        environmentInjector: this.injector,
      });

      componentRef.setInput('title', data.title);
      componentRef.setInput('message', data.message);
      componentRef.setInput('weightUnit', data.weightUnit);
      componentRef.setInput('allowManualFallback', data.allowManualFallback);

      const destroy = () => {
        this.appRef.detachView(componentRef.hostView);
        componentRef.destroy();
      };

      const sub = componentRef.instance.confirm.subscribe((weight: number) => {
        resolve(weight);
        sub.unsubscribe();
        destroy();
      });

      const subCancel = componentRef.instance.cancel.subscribe(() => {
        resolve(undefined);
        subCancel.unsubscribe();
        destroy();
      });

      this.appRef.attachView(componentRef.hostView);
      const domElem = (componentRef.hostView as any).rootNodes[0] as HTMLElement;
      document.body.appendChild(domElem);
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  // --- Private ---

  private startReadLoop(): void {
    if (!this.port?.readable) return;

    this.readLoopAbortController = new AbortController();
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable, {
      signal: this.readLoopAbortController.signal,
    }).catch(() => {
      // Stream aborted or port disconnected
    });

    this.reader = textDecoder.readable.getReader();
    this.readLoop(readableStreamClosed);
  }

  private async readLoop(streamClosed: Promise<void>): Promise<void> {
    let lineBuffer = '';

    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;

        lineBuffer += value;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) this.parseLine(trimmed);
        }
      }
    } catch {
      // Read error — port likely disconnected
    }

    this.reader = null;
    await streamClosed;

    if (this.status$.value === 'connected') {
      this.status$.next('error');
    }
  }

  private parseLine(line: string): void {
    let weight: number | null = null;
    let isStable = false;

    switch (this.config.protocol) {
      case 'cas':
        ({ weight, isStable } = this.parseCas(line));
        break;
      case 'ohaus':
        ({ weight, isStable } = this.parseOhaus(line));
        break;
      default:
        ({ weight, isStable } = this.parseGeneric(line));
        break;
    }

    if (weight !== null && !isNaN(weight)) {
      this.weight$.next(weight);
      this.updateStability(weight, isStable);
    }
  }

  private parseGeneric(line: string): { weight: number | null; isStable: boolean } {
    const match = line.match(/([+-]?\d+\.?\d*)\s*(kg|g|lb)?/i);
    if (!match) return { weight: null, isStable: false };

    return {
      weight: parseFloat(match[1]),
      isStable: /\bST\b/i.test(line) || /\bstable\b/i.test(line),
    };
  }

  private parseCas(line: string): { weight: number | null; isStable: boolean } {
    // Format: ST,GS,  0.500,kg  or  US,GS,  0.500,kg
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 3) return { weight: null, isStable: false };

    return {
      weight: parseFloat(parts[2]),
      isStable: parts[0] === 'ST',
    };
  }

  private parseOhaus(line: string): { weight: number | null; isStable: boolean } {
    // Format similar to CAS: indicator, mode, weight, unit
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 3) return { weight: null, isStable: false };

    const weightStr = parts.find(p => /^[+-]?\d+\.?\d*$/.test(p));
    return {
      weight: weightStr ? parseFloat(weightStr) : null,
      isStable: /\bST\b/i.test(parts[0]) || /\bstable\b/i.test(parts[0]),
    };
  }

  private updateStability(weight: number, protocolStable: boolean): void {
    this.recentReadings.push(weight);
    if (this.recentReadings.length > STABILITY_READINGS) {
      this.recentReadings.shift();
    }

    if (protocolStable) {
      this.stable$.next(true);
      return;
    }

    // Check if last N readings are within tolerance
    if (this.recentReadings.length >= STABILITY_READINGS) {
      const max = Math.max(...this.recentReadings);
      const min = Math.min(...this.recentReadings);
      this.stable$.next(max - min <= STABILITY_TOLERANCE);
    } else {
      this.stable$.next(false);
    }
  }
}
