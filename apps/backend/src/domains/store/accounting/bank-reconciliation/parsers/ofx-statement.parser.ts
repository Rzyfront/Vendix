import { Injectable, Logger } from '@nestjs/common';

import {
  ParsedTransaction,
  StatementParseResult,
} from './interfaces/parsed-transaction.interface';

@Injectable()
export class OfxStatementParser {
  private readonly logger = new Logger(OfxStatementParser.name);

  async parse(buffer: Buffer): Promise<StatementParseResult> {
    const result: StatementParseResult = {
      transactions: [],
      errors: [],
    };

    try {
      const content = buffer.toString('utf-8');

      result.account_number =
        this.extractTag(content, 'ACCTID') ?? undefined;

      const balAmtStr = this.extractNestedTag(
        content,
        'LEDGERBAL',
        'BALAMT',
      );
      if (balAmtStr) {
        const balAmt = parseFloat(balAmtStr);
        if (!isNaN(balAmt)) {
          result.closing_balance = balAmt;
        }
      }

      const transactionBlocks = this.extractBlocks(content, 'STMTTRN');

      for (let i = 0; i < transactionBlocks.length; i++) {
        try {
          const transaction = this.parseTransaction(transactionBlocks[i]);
          if (transaction) {
            result.transactions.push(transaction);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Transaction ${i + 1}: ${message}`);
          this.logger.warn(
            `Error parsing OFX transaction ${i + 1}: ${message}`,
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to parse OFX: ${message}`);
      this.logger.error(`OFX parsing failed: ${message}`);
    }

    return result;
  }

  private parseTransaction(block: string): ParsedTransaction | null {
    const dtPosted = this.extractTag(block, 'DTPOSTED');
    if (!dtPosted) {
      throw new Error('Missing DTPOSTED');
    }

    const trnAmtStr = this.extractTag(block, 'TRNAMT');
    if (!trnAmtStr) {
      throw new Error('Missing TRNAMT');
    }

    const date = this.parseOfxDate(dtPosted);
    if (!date || isNaN(date.getTime())) {
      throw new Error(`Invalid date "${dtPosted}"`);
    }

    const amount = parseFloat(trnAmtStr);
    if (isNaN(amount)) {
      throw new Error(`Invalid amount "${trnAmtStr}"`);
    }

    const name = this.extractTag(block, 'NAME');
    const memo = this.extractTag(block, 'MEMO');
    const description = [name, memo].filter(Boolean).join(' - ') || 'N/A';

    const fitId = this.extractTag(block, 'FITID');
    const checkNum = this.extractTag(block, 'CHECKNUM');
    const trnType = this.extractTag(block, 'TRNTYPE');

    const type: 'debit' | 'credit' = amount >= 0 ? 'credit' : 'debit';

    return {
      date,
      description: trnType ? `[${trnType}] ${description}` : description,
      amount: Math.abs(amount),
      type,
      reference: checkNum || undefined,
      external_id: fitId || undefined,
      counterparty: name || undefined,
    };
  }

  private parseOfxDate(dateStr: string): Date {
    // OFX dates: YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS.XXX
    const cleaned = dateStr.replace(/\[.*\]/, '').trim();
    const year = parseInt(cleaned.substring(0, 4), 10);
    const month = parseInt(cleaned.substring(4, 6), 10);
    const day = parseInt(cleaned.substring(6, 8), 10);

    let hours = 0,
      minutes = 0,
      seconds = 0;

    if (cleaned.length >= 14) {
      hours = parseInt(cleaned.substring(8, 10), 10);
      minutes = parseInt(cleaned.substring(10, 12), 10);
      seconds = parseInt(cleaned.substring(12, 14), 10);
    }

    return new Date(year, month - 1, day, hours, minutes, seconds);
  }

  private extractTag(content: string, tag: string): string | null {
    // OFX SGML-style: <TAG>value or <TAG>value</TAG>
    const closingTagRegex = new RegExp(
      `<${tag}>([^<]*)</${tag}>`,
      'i',
    );
    const closingMatch = closingTagRegex.exec(content);
    if (closingMatch) {
      return closingMatch[1].trim();
    }

    // SGML style without closing tag: <TAG>value\n
    const sgmlRegex = new RegExp(
      `<${tag}>([^\\n<]+)`,
      'i',
    );
    const sgmlMatch = sgmlRegex.exec(content);
    if (sgmlMatch) {
      return sgmlMatch[1].trim();
    }

    return null;
  }

  private extractNestedTag(
    content: string,
    parentTag: string,
    childTag: string,
  ): string | null {
    const parentRegex = new RegExp(
      `<${parentTag}>([\\s\\S]*?)(?:</${parentTag}>|<(?!${childTag})[A-Z])`,
      'i',
    );
    const parentMatch = parentRegex.exec(content);
    if (!parentMatch) {
      return null;
    }
    return this.extractTag(parentMatch[1], childTag);
  }

  private extractBlocks(content: string, tag: string): string[] {
    const blocks: string[] = [];
    const regex = new RegExp(
      `<${tag}>([\\s\\S]*?)</${tag}>`,
      'gi',
    );

    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      blocks.push(match[1]);
    }

    return blocks;
  }
}
