import { Injectable } from '@nestjs/common';
import type { BulkJobType, BulkUploadJobHandler } from './bulk-upload-job.types';

/** Registro singleton tipo -> handler. Cada dominio registra el suyo en `onModuleInit`. */
@Injectable()
export class BulkUploadHandlerRegistry {
  private readonly handlers = new Map<BulkJobType, BulkUploadJobHandler>();

  register(handler: BulkUploadJobHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `Bulk upload handler already registered for type "${handler.type}"`,
      );
    }
    this.handlers.set(handler.type, handler);
  }

  get(type: BulkJobType): BulkUploadJobHandler | undefined {
    return this.handlers.get(type);
  }
}
