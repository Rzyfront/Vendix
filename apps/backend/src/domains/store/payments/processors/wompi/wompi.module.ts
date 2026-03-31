import { Module } from '@nestjs/common';
import { WompiClient } from './wompi.client';
import { WompiProcessor } from './wompi.processor';

@Module({
  providers: [
    WompiClient,
    {
      provide: WompiProcessor,
      useFactory: (client: WompiClient) => new WompiProcessor(client),
      inject: [WompiClient],
    },
  ],
  exports: [WompiProcessor, WompiClient],
})
export class WompiModule {}
