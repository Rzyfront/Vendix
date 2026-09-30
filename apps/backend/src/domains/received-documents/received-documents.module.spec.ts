import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ReceivedDocumentsModule } from './received-documents.module';
import { PublicDocumentReceptionWebhookController } from './public-document-reception-webhook.controller';
import { DocumentReceptionEnvelopeService } from './services/document-reception-envelope.service';
import { DocumentReceptionIngestService } from './services/document-reception-ingest.service';
import { DocumentReceptionSyncLeaseService } from './services/document-reception-sync-lease.service';
import { DocumentReceptionWebhookService } from './services/document-reception-webhook.service';
import { DocumentReceptionSyncService } from './services/document-reception-sync.service';
import { DocumentReceptionSyncQueueService } from './services/document-reception-sync-queue.service';
import { DocumentReceptionSyncProcessor } from './services/document-reception-sync.processor';
import { DocumentReceptionSyncSchedulerService } from './services/document-reception-sync-scheduler.service';
import { DocumentReceptionManualSyncService } from './services/document-reception-manual-sync.service';
import { DocumentReceptionRunResolutionService } from './services/document-reception-run-resolution.service';
import { ReceivedDocumentsContextService } from './services/received-documents-context.service';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentScanQueueService } from './services/received-document-scan-queue.service';
import { DocumentReceptionConnectionsService } from './services/document-reception-connections.service';

describe('ReceivedDocumentsModule pipeline wiring', () => {
  const imports: any[] = Reflect.getMetadata('imports', ReceivedDocumentsModule) ?? [];
  const controllers: any[] = Reflect.getMetadata('controllers', ReceivedDocumentsModule) ?? [];
  const providers: any[] = Reflect.getMetadata('providers', ReceivedDocumentsModule) ?? [];
  const exports: any[] = Reflect.getMetadata('exports', ReceivedDocumentsModule) ?? [];

  it('registers scan and sync Bull queues exactly once', () => {
    const queues = imports.filter((entry) => entry?.module === BullModule);
    const tokens = queues.flatMap((queue) => (queue.providers ?? []).map((provider: any) => provider.provide));

    expect(tokens).toContain(getQueueToken('received-document-scan'));
    expect(tokens).toContain(getQueueToken('document-reception-sync'));
    expect(tokens.filter((token) => token === getQueueToken('document-reception-sync'))).toHaveLength(1);
  });

  it('registers exactly one public webhook controller in the shared module', () => {
    expect(controllers.filter((controller) => controller === PublicDocumentReceptionWebhookController)).toHaveLength(1);
  });

  it('provides every durable sync pipeline component without duplicate provider tokens', () => {
    const required = [
      DocumentReceptionEnvelopeService,
      DocumentReceptionIngestService,
      DocumentReceptionSyncLeaseService,
      DocumentReceptionWebhookService,
      DocumentReceptionSyncService,
      DocumentReceptionSyncQueueService,
      DocumentReceptionSyncProcessor,
      DocumentReceptionSyncSchedulerService,
      DocumentReceptionManualSyncService,
      DocumentReceptionRunResolutionService,
    ];
    const tokens = providers.map((provider) => typeof provider === 'function' ? provider : provider?.provide);

    for (const provider of required) {
      expect(tokens.filter((token) => token === provider)).toHaveLength(1);
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('exports connection command services to the store and organization controllers through the shared module', () => {
    expect(exports).toEqual(expect.arrayContaining([
      ReceivedDocumentsContextService,
      ReceivedDocumentsService,
      ReceivedDocumentScanQueueService,
      DocumentReceptionConnectionsService,
      DocumentReceptionManualSyncService,
      DocumentReceptionRunResolutionService,
    ]));
    expect(exports.filter((token) => token === DocumentReceptionRunResolutionService)).toHaveLength(1);
    expect(exports).not.toContain(DocumentReceptionSyncLeaseService);
    expect(exports).not.toContain(DocumentReceptionSyncQueueService);
  });
});
