import { Module } from '@nestjs/common';
import { SheetParserService } from './sheets/sheet-parser.service';
import { AiExtractionService } from './extraction/ai-extraction.service';
import { IngestProfileRegistry } from './profiles/registry';
import { DocumentPagesService } from './documents/document-pages.service';

/**
 * Shared pipeline for AI file loads (plan ia-cargas). Not `@Global`: each
 * domain that loads files with AI imports it. `AIEngineService` comes from
 * the global `AIEngineModule`, so this module adds no cycle.
 */
@Module({
  providers: [
    SheetParserService,
    AiExtractionService,
    IngestProfileRegistry,
    DocumentPagesService,
  ],
  exports: [
    SheetParserService,
    AiExtractionService,
    IngestProfileRegistry,
    DocumentPagesService,
  ],
})
export class AiIngestModule {}
