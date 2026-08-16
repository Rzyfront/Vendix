import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DianSecretEnvelopeService } from './dian-secret-envelope.service';
import { EncryptionService } from './encryption.service';
import { TechnicalKeyVaultService } from './technical-key-vault.service';

/**
 * `PrismaModule` is imported for `DianSecretEnvelopeService`, which rewrites the
 * `dian_configurations` secret columns in place, and for
 * `TechnicalKeyVaultService`, which does the same for the ClTec of
 * `invoice_resolutions`. No cycle: `PrismaModule` has no `imports` of its own
 * and never depends on encryption.
 *
 * `TechnicalKeyVaultService` lives in this `@Global()` module on purpose. Its
 * consumers span three domains — store invoicing, organization invoicing and the
 * super-admin fiscal console — plus `common/` itself; registering it here is what
 * lets every one of them inject it without a single module edit, and it is the
 * only way the three write paths end up writing the same three columns.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    EncryptionService,
    DianSecretEnvelopeService,
    TechnicalKeyVaultService,
  ],
  exports: [
    EncryptionService,
    DianSecretEnvelopeService,
    TechnicalKeyVaultService,
  ],
})
export class EncryptionModule {}
