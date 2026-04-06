import { Global, Module } from '@nestjs/common';
import { PerformanceCollectorService } from './services/performance-collector.service';

@Global()
@Module({
  providers: [PerformanceCollectorService],
  exports: [PerformanceCollectorService],
})
export class PerformanceModule {}
