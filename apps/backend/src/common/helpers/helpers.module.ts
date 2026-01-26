import { Module, Global } from '@nestjs/common';
import { DomainGeneratorHelper } from './domain-generator.helper';

/**
 * Helpers Module
 *
 * Provides utility helper services that can be used across the application.
 * This module is decorated with @Global() so it's available everywhere without
 * needing to be imported in other modules.
 */
@Global()
@Module({
  providers: [DomainGeneratorHelper],
  exports: [DomainGeneratorHelper],
})
export class HelpersModule {}
