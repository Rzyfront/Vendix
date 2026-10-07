import { Injectable } from '@nestjs/common';
import { AiScanHandler, AiScanKind } from './interfaces/ai-scan-job.interface';

/** Registro singleton kind -> handler. Cada dominio registra el suyo en onModuleInit. */
@Injectable()
export class AiScanHandlerRegistry {
  private readonly handlers = new Map<AiScanKind, AiScanHandler<any>>();

  register<T = unknown>(kind: AiScanKind, handler: AiScanHandler<T>): void {
    if (this.handlers.has(kind)) {
      throw new Error(`AI scan handler already registered for kind "${kind}"`);
    }
    this.handlers.set(kind, handler);
  }

  get(kind: AiScanKind): AiScanHandler<any> | undefined {
    return this.handlers.get(kind);
  }
}
