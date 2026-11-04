import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { StoreAccessGateController } from './access-gate.controller';

/** AccessGateService comes from the global `AccessModule`. */
@Module({
  imports: [ResponseModule],
  controllers: [StoreAccessGateController],
})
export class StoreAccessGateModule {}
