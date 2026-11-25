import { BulkUploadsModule } from '../bulk-uploads/bulk-uploads.module';
import { BulkUploadHandlerRegistry } from '../bulk-uploads/bulk-upload-handler.registry';
import { CustomersBulkJobHandler } from './customers-bulk-job.handler';
import { S3Module } from '@common/services/s3.module';
import { AiIngestModule } from '@common/ai-ingest/ai-ingest.module';
import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createCustomerTools } from '../../../ai-engine/tools/domains/customers.tools';
import { createCustomerWriteTools } from '../../../ai-engine/tools/domains/writes.tools';
import { CustomersService } from './customers.service';
import { CustomerLookupService } from './customer-lookup.service';
import { SocrataClient } from './external-identity/socrata.client';
import { RuesSource } from './external-identity/rues.source';
import { SecopProveedoresSource } from './external-identity/secop-proveedores.source';
import { SecopContratosSource } from './external-identity/secop-contratos.source';
import { RntSource } from './external-identity/rnt.source';
import { ExternalIdentityLookupService } from './external-identity/external-identity-lookup.service';
import { CustomersController } from './customers.controller';
import { CustomersBulkService } from './customers-bulk.service';
import { CustomersBulkController } from './customers-bulk.controller';
import { CustomersBulkEditService } from './customers-bulk-edit.service';
import { CustomersBulkEditController } from './customers-bulk-edit.controller';
import { CustomerHistoryController } from './history/customer-history.controller';
import { CustomerHistoryService } from './history/customer-history.service';
import { CustomerEmailListener } from './customer-email.listener';
import { CustomerAiImportController } from './ai-import/customer-ai-import.controller';
import { CustomerAiImportService } from './ai-import/customer-ai-import.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { MetadataModule } from '../metadata/metadata.module';
import { EmailModule } from '../../../email/email.module';
import { AddressesModule } from '../addresses/addresses.module';
import { CustomerCrmModule } from './crm/customer-crm.module';

@Module({
  imports: [
    ResponseModule,
    MetadataModule,
    EmailModule,
    AddressesModule,
    BulkUploadsModule,
    S3Module,
    AiIngestModule,
    // El listado filtra por segmento con `CrmSegmentQueryService` (evaluacion de
    // reglas); el CRM ya importa este modulo, asi que el ciclo es explicito.
    forwardRef(() => CustomerCrmModule),
  ],
  controllers: [
    CustomersController,
    CustomersBulkController,
    // Edición masiva de clientes: superficie propia (preview + apply + listado
    // filtrado) para no mezclar la escritura en lote con la carga masiva, que
    // tiene su propio DTO de filas y su propio job.
    CustomersBulkEditController,
    CustomerHistoryController,
    CustomerAiImportController,
  ],
  providers: [
    CustomersService,
    CustomerLookupService,
    SocrataClient,
    RuesSource,
    SecopProveedoresSource,
    SecopContratosSource,
    RntSource,
    ExternalIdentityLookupService,
    CustomersBulkService,
    CustomersBulkEditService,
    CustomersBulkJobHandler,
    CustomerHistoryService,
    CustomerEmailListener,
    CustomerAiImportService,
  ],
  exports: [
    CustomersService,
    CustomerLookupService,
    CustomerHistoryService,
    // Consulta pública RUES/SECOP/RNT: también la usa el riel super-admin
    // (`superadmin/subscriptions/fiscal/customers/lookup/external`).
    ExternalIdentityLookupService,
  ],
})
export class CustomersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly customersService: CustomersService,
    private readonly bulkJobRegistry: BulkUploadHandlerRegistry,
    private readonly customersBulkJobHandler: CustomersBulkJobHandler,
  ) {}

  /**
   * Registers the customers tool family for the AI agent. It lives here and
   * not in `AIEngineModule` because that module is `@Global()`: importing one
   * domain module per tool family into it generates dependency cycles.
   * `AIToolRegistry` is exported globally, so the dependency points from the
   * domain to the engine and this module imports nothing extra.
   */
  onModuleInit(): void {
    // QUI-1009: carga masiva durable de clientes.
    this.bulkJobRegistry.register(this.customersBulkJobHandler);

    this.toolRegistry.registerMany(
      createCustomerTools({
        customersService: this.customersService,
      }),
    );

    // `upsert_customer`: crear o corregir un cliente. Delega en
    // `CustomersService`, dueño del rol `customer`, del vínculo con la tienda y
    // de la unicidad de documento dentro de la organización.
    this.toolRegistry.registerMany(
      createCustomerWriteTools({
        customersService: this.customersService,
      }),
    );
  }
}
