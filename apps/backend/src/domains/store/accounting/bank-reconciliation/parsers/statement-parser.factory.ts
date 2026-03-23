import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'path';

import {
  ColumnMappingConfig,
  StatementParseResult,
} from './interfaces/parsed-transaction.interface';
import { CsvStatementParser } from './csv-statement.parser';
import { OfxStatementParser } from './ofx-statement.parser';
import { Mt940StatementParser } from './mt940-statement.parser';

const SUPPORTED_FORMATS = ['.csv', '.txt', '.ofx', '.qfx', '.sta', '.mt940', '.940'];

@Injectable()
export class StatementParserFactory {
  private readonly logger = new Logger(StatementParserFactory.name);

  constructor(
    private readonly csvParser: CsvStatementParser,
    private readonly ofxParser: OfxStatementParser,
    private readonly mt940Parser: Mt940StatementParser,
  ) {}

  getParser(filename: string, buffer?: Buffer): 'csv' | 'ofx' | 'mt940' {
    const ext = extname(filename).toLowerCase();

    switch (ext) {
      case '.sta':
      case '.mt940':
      case '.940':
        return 'mt940';
      case '.csv':
      case '.txt':
        // Auto-detect MT940 by content for .txt files
        if (buffer && this.isMt940Content(buffer)) {
          return 'mt940';
        }
        return 'csv';
      case '.ofx':
      case '.qfx':
        return 'ofx';
      default:
        throw new Error(
          `Unsupported file format "${ext}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}`,
        );
    }
  }

  async parse(
    buffer: Buffer,
    filename: string,
    columnMapping?: ColumnMappingConfig,
  ): Promise<StatementParseResult> {
    const parserType = this.getParser(filename, buffer);

    this.logger.log(
      `Parsing statement "${filename}" with ${parserType} parser`,
    );

    if (parserType === 'mt940') {
      return this.mt940Parser.parse(buffer);
    }

    if (parserType === 'csv') {
      if (!columnMapping) {
        throw new Error(
          'Column mapping configuration is required for CSV/TXT files',
        );
      }
      return this.csvParser.parse(buffer, columnMapping);
    }

    return this.ofxParser.parse(buffer);
  }

  /**
   * Detects MT940 content by looking for characteristic SWIFT tags.
   * MT940 files always contain :20:, :25:, and :60F: tags.
   */
  private isMt940Content(buffer: Buffer): boolean {
    const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 2048));
    return (
      content.includes(':20:') &&
      content.includes(':25:') &&
      (content.includes(':60F:') || content.includes(':61:'))
    );
  }
}
