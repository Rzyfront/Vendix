import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DianSecretEnvelopeService } from './dian-secret-envelope.service';
import { EncryptionService } from './encryption.service';

/**
 * `PrismaModule` is imported for `DianSecretEnvelopeService`, which rewrites the
 * `dian_configurations` secret columns in place. No cycle: `PrismaModule` has no
 * `imports` of its own and never depends on encryption.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [EncryptionService, DianSecretEnvelopeService],
  exports: [EncryptionService, DianSecretEnvelopeService],
})
export class EncryptionModule {}
