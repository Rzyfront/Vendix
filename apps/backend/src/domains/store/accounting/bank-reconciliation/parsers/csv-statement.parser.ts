import { Injectable, Logger } from '@nestjs/common';

const { parse: csvParse } = require('csv-parse/sync');
import { createHash } from 'crypto';

import {
  ColumnMappingConfig,
  ParsedTransaction,
  StatementParseResult,
} from './interfaces/parsed-transaction.interface';

@Injectable()
export class CsvStatementParser {
  private readonly logger = new Logger(CsvStatementParser.name);

  async parse(
    buffer: Buffer,
    mapping: ColumnMappingConfig,
  ): Promise<StatementParseResult> {
    const result: StatementParseResult = {
      transactions: [],
      errors: [],
    };

    try {
      const content = buffer.toString('utf-8');
      const delimiter = this.detectDelimiter(content);
      const lines = content.split(/\r?\n/).filter((l) => l.trim());

      const skipRows = mapping.skip_rows ?? 0;
      const csvContent = lines.slice(skipRows).join('\n');

      const records: Record<string, string>[] = csvParse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        delimiter,
        trim: true,
        relax_column_count: true,
      });

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + skipRows + 2; // +2 for 1-indexed + header row

        try {
          const transaction = this.parseRow(row, mapping, rowNum);
          if (transaction) {
            result.transactions.push(transaction);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Row ${rowNum}: ${message}`);
          this.logger.warn(`Error parsing row ${rowNum}: ${message}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to parse CSV: ${message}`);
      this.logger.error(`CSV parsing failed: ${message}`);
    }

    return result;
  }

  private parseRow(
    row: Record<string, string>,
    mapping: ColumnMappingConfig,
    rowNum: number,
  ): ParsedTransaction | null {
    const dateStr = row[mapping.date_column]?.trim();
    if (!dateStr) {
      throw new Error(`Missing date value in column "${mapping.date_column}"`);
    }

    const date = this.parseDate(dateStr, mapping.date_format);
    if (!date || isNaN(date.getTime())) {
      throw new Error(
        `Invalid date "${dateStr}" (expected format: ${mapping.date_format || 'YYYY-MM-DD'})`,
      );
    }

    const description = row[mapping.description_column]?.trim();
    if (!description) {
      throw new Error(
        `Missing description in column "${mapping.description_column}"`,
      );
    }

    let amount: number;
    let type: 'debit' | 'credit';

    if (mapping.amount_column) {
      const rawAmount = row[mapping.amount_column]?.trim();
      if (!rawAmount) {
        throw new Error(`Missing amount in column "${mapping.amount_column}"`);
      }
      amount = this.parseAmount(rawAmount, mapping.decimal_separator);
      if (isNaN(amount)) {
        throw new Error(`Invalid amount "${rawAmount}" in row ${rowNum}`);
      }
      type = amount >= 0 ? 'credit' : 'debit';
      amount = Math.abs(amount);
    } else if (mapping.debit_column && mapping.credit_column) {
      const rawDebit = row[mapping.debit_column]?.trim();
      const rawCredit = row[mapping.credit_column]?.trim();

      const debitAmount = rawDebit
        ? this.parseAmount(rawDebit, mapping.decimal_separator)
        : 0;
      const creditAmount = rawCredit
        ? this.parseAmount(rawCredit, mapping.decimal_separator)
        : 0;

      if (debitAmount && !isNaN(debitAmount) && debitAmount > 0) {
        amount = debitAmount;
        type = 'debit';
      } else if (creditAmount && !isNaN(creditAmount) && creditAmount > 0) {
        amount = creditAmount;
        type = 'credit';
      } else {
        throw new Error(
          `No valid debit or credit amount found in row ${rowNum}`,
        );
      }
    } else {
      throw new Error(
        'Mapping must specify either amount_column or both debit_column and credit_column',
      );
    }

    const reference = mapping.reference_column
      ? row[mapping.reference_column]?.trim() || undefined
      : undefined;

    const counterparty = mapping.counterparty_column
      ? row[mapping.counterparty_column]?.trim() || undefined
      : undefined;

    let externalId: string | undefined;
    if (mapping.external_id_column) {
      externalId = row[mapping.external_id_column]?.trim() || undefined;
    }
    if (!externalId) {
      externalId = this.generateExternalId(date, amount, description);
    }

    return {
      date,
      description,
      amount,
      type,
      reference,
      external_id: externalId,
      counterparty,
    };
  }

  private detectDelimiter(content: string): string {
    const firstLine = content.split(/\r?\n/)[0] || '';
    const delimiters = [';', ',', '\t'];
    let bestDelimiter = ',';
    let maxColumns = 0;

    for (const d of delimiters) {
      const count = firstLine.split(d).length;
      if (count > maxColumns) {
        maxColumns = count;
        bestDelimiter = d;
      }
    }

    return bestDelimiter;
  }

  private parseDate(dateStr: string, format?: string): Date {
    const fmt = format || 'YYYY-MM-DD';

    let day: number, month: number, year: number;

    const cleaned = dateStr.replace(/\//g, '-');
    const parts = cleaned.split('-');

    if (parts.length !== 3) {
      return new Date(dateStr);
    }

    switch (fmt) {
      case 'DD/MM/YYYY':
      case 'DD-MM-YYYY':
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
        break;
      case 'MM/DD/YYYY':
      case 'MM-DD-YYYY':
        month = parseInt(parts[0], 10);
        day = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
        break;
      case 'YYYY-MM-DD':
      case 'YYYY/MM/DD':
      default:
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
        break;
    }

    return new Date(year, month - 1, day);
  }

  private parseAmount(raw: string, decimalSeparator?: '.' | ','): number {
    let cleaned = raw.replace(/[^\d.,\-+]/g, '');

    if (decimalSeparator === ',') {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }

    return parseFloat(cleaned);
  }

  private generateExternalId(
    date: Date,
    amount: number,
    description: string,
  ): string {
    const raw = `${date.toISOString()}|${amount}|${description}`;
    return createHash('sha256').update(raw).digest('hex').substring(0, 16);
  }
}
