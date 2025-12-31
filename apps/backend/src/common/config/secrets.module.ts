import { Global, Module } from '@nestjs/common';
import { SecretsManagerService } from '../services/secrets-manager.service';

@Global()
@Module({
  providers: [SecretsManagerService],
  exports: [SecretsManagerService],
})
export class SecretsModule {}
