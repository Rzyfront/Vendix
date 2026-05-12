import { Global, Module } from '@nestjs/common';
import { DnsResolverService } from './dns-resolver.service';

@Global()
@Module({
  providers: [DnsResolverService],
  exports: [DnsResolverService],
})
export class DnsModule {}
