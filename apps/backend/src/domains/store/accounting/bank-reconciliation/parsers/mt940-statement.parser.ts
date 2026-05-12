import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  ParsedTransaction,
  StatementParseResult,
} from './interfaces/parsed-transaction.interface';

/**
 * Parser for SWIFT MT940 bank statement files.
 *
 * Supported tags:
 * - :20:  Transaction Reference Number
 * - :25:  Account Identification
 * - :28C: Statement Number / Sequence Number
 * - :60F: Opening Balance
 * - :61:  Statement Line (transaction)
 * - :86:  Information to Account Owner (transaction detail)
 * - :62F: Closing Balance (available)
 *
 * MT940 format reference: SWIFT Standards — Category 9 Messages
 */
@Injectable()
export class Mt940StatementParser {
  private readonly logger = new Logger(Mt940StatementParser.name);

  async parse(buffer: Buffer): Promise<StatementParseResult> {
    const result: StatementParseResult = {
      transactions: [],
      errors: [],
    };

    try {
      const content = buffer.toString('utf-8');

      // Extract account number from :25: tag
      const account_match = /:25:(.+)/m.exec(content);
      if (account_match) {
        result.account_number = account_match[1].trim();
      }

      // Extract statement date from :28C: (informational only)
      const statement_number_match = /:28C:(.+)/m.exec(content);
      if (statement_number_match) {
        // :28C: contains statement number, not date — kept for reference
        this.logger.debug(
          `Statement number: ${statement_number_match[1].trim()}`,
        );
      }

      // Extract opening balance from :60F:
      const opening_match = /:60F:([CD])(\d{6})([A-Z]{3})([\d,]+)/m.exec(
        content,
      );
      if (opening_match) {
        const amount = this.parseAmount(opening_match[4]);
        result.opening_balance = opening_match[1] === 'D' ? -amount : amount;

        // Extract statement date from the opening balance date
        result.statement_date = this.parseMt940Date(opening_match[2]);
      }

      // Extract closing balance from :62F:
      const closing_match = /:62F:([CD])(\d{6})([A-Z]{3})([\d,]+)/m.exec(
        content,
      );
      if (closing_match) {
        const amount = this.parseAmount(closing_match[4]);
        result.closing_balance = closing_match[1] === 'D' ? -amount : amount;
      }

      // Parse transactions — each :61: line followed optionally by :86:
      const transactions = this.extractTransactions(content);

      for (let i = 0; i < transactions.length; i++) {
        try {
          const transaction = this.parseTransaction(
            transactions[i].line61,
            transactions[i].line86,
          );
          if (transaction) {
            result.transactions.push(transaction);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          result.errors.push(`Transaction ${i + 1}: ${message}`);
          this.logger.warn(
            `Error parsing MT940 transaction ${i + 1}: ${message}`,
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to parse MT940: ${message}`);
      this.logger.error(`MT940 parsing failed: ${message}`);
    }

    return result;
  }

  /**
   * Extracts :61: and optional :86: pairs from the MT940 content.
   * Each :61: starts a transaction, and the immediately following :86:
   * (if any) provides supplementary information.
   */
  private extractTransactions(
    content: string,
  ): Array<{ line61: string; line86?: string }> {
    const transactions: Array<{ line61: string; line86?: string }> = [];

    // Split content into tag blocks
    // MT940 tags start with : at the beginning of a line
    const lines = content.split(/\r?\n/);
    let current_tag = '';
    let current_value = '';
    const tags: Array<{ tag: string; value: string }> = [];

    for (const line of lines) {
      const tag_match = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
      if (tag_match) {
        // Save previous tag
        if (current_tag) {
          tags.push({ tag: current_tag, value: current_value.trim() });
        }
        current_tag = tag_match[1];
        current_value = tag_match[2];
      } else if (current_tag) {
        // Continuation line
        current_value += '\n' + line;
      }
    }

    // Save last tag
    if (current_tag) {
      tags.push({ tag: current_tag, value: current_value.trim() });
    }

    // Pair :61: with following :86: (if present)
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].tag === '61') {
        const line86 =
          i + 1 < tags.length && tags[i + 1].tag === '86'
            ? tags[i + 1].value
            : undefined;
        transactions.push({
          line61: tags[i].value,
          line86,
        });
      }
    }

    return transactions;
  }

  /**
   * Parses a single :61: transaction line.
   *
   * Format: YYMMDD[MMDD]CD[amount]S[transaction_type][reference]
   *
   * Field layout (fixed positions):
   * - Pos 0-5:  Value date (YYMMDD) — mandatory
   * - Pos 6-9:  Entry date (MMDD) — optional
   * - Next:     Debit/Credit mark (D, C, RD, RC)
   * - Next:     Amount (digits and comma)
   * - Next:     Transaction type code (S + 3 chars)
   * - Next:     Reference (rest of first line)
   */
  private parseTransaction(
    line61: string,
    line86?: string,
  ): ParsedTransaction | null {
    if (!line61 || line61.trim().length < 16) {
      throw new Error(`Invalid :61: line — too short: "${line61}"`);
    }

    // Parse value date (first 6 characters: YYMMDD)
    const value_date_str = line61.substring(0, 6);
    const value_date = this.parseMt940Date(value_date_str);
    if (!value_date || isNaN(value_date.getTime())) {
      throw new Error(`Invalid value date "${value_date_str}"`);
    }

    // Check for optional entry date (next 4 characters: MMDD)
    let pos = 6;
    let entry_date: Date | undefined;
    if (/^\d{4}/.test(line61.substring(pos))) {
      const entry_mmdd = line61.substring(pos, pos + 4);
      const year = value_date.getFullYear();
      const month = parseInt(entry_mmdd.substring(0, 2), 10);
      const day = parseInt(entry_mmdd.substring(2, 4), 10);
      entry_date = new Date(year, month - 1, day);
      pos += 4;
    }

    // Parse D/C indicator (D, C, RD, RC)
    let dc_mark: string;
    if (
      line61.substring(pos, pos + 2) === 'RD' ||
      line61.substring(pos, pos + 2) === 'RC'
    ) {
      dc_mark = line61.substring(pos, pos + 2);
      pos += 2;
    } else {
      dc_mark = line61.substring(pos, pos + 1);
      pos += 1;
    }

    // Optional: currency letter (third character of currency)
    if (
      /^[A-Z]/.test(line61.substring(pos, pos + 1)) &&
      !/^\d/.test(line61.substring(pos, pos + 1))
    ) {
      pos += 1; // skip currency letter
    }

    // Parse amount (digits and comma until non-digit-non-comma)
    const amount_match = /^([\d,]+)/.exec(line61.substring(pos));
    if (!amount_match) {
      throw new Error(`Cannot parse amount from :61: line at position ${pos}`);
    }

    const amount = this.parseAmount(amount_match[1]);
    pos += amount_match[1].length;

    // Parse transaction type code (S/N + 3 chars)
    let transaction_type = '';
    if (line61.length > pos) {
      const type_match = /^([SN]\w{3})/.exec(line61.substring(pos));
      if (type_match) {
        transaction_type = type_match[1];
        pos += type_match[1].length;
      }
    }

    // Parse reference (rest of the line)
    const reference = line61.substring(pos).trim() || undefined;

    // Determine debit/credit type
    // D = debit, C = credit, RD = reversal of debit (= credit), RC = reversal of credit (= debit)
    const type: 'debit' | 'credit' =
      dc_mark === 'C' || dc_mark === 'RD' ? 'credit' : 'debit';

    // Build description from :86: or fallback
    let description = 'N/A';
    if (line86) {
      // Remove multiline continuation formatting
      description = line86.replace(/\r?\n/g, ' ').trim();
    } else if (transaction_type) {
      description = `[${transaction_type}]${reference ? ' ' + reference : ''}`;
    }

    // Generate external ID from transaction data
    const external_id = this.generateExternalId(
      value_date,
      amount,
      dc_mark,
      reference || '',
    );

    return {
      date: value_date,
      value_date: entry_date,
      description,
      amount,
      type,
      reference,
      external_id,
    };
  }

  /**
   * Parses a 6-digit MT940 date (YYMMDD) into a Date object.
   * Assumes 2000s for YY < 80, 1900s for YY >= 80.
   */
  private parseMt940Date(dateStr: string): Date {
    const yy = parseInt(dateStr.substring(0, 2), 10);
    const mm = parseInt(dateStr.substring(2, 4), 10);
    const dd = parseInt(dateStr.substring(4, 6), 10);

    const year = yy < 80 ? 2000 + yy : 1900 + yy;

    return new Date(year, mm - 1, dd);
  }

  /**
   * Parses an MT940 amount string (comma as decimal separator).
   * Example: "1234,56" -> 1234.56
   */
  private parseAmount(raw: string): number {
    const cleaned = raw.replace(/,/, '.');
    const amount = parseFloat(cleaned);
    if (isNaN(amount)) {
      throw new Error(`Invalid MT940 amount "${raw}"`);
    }
    return amount;
  }

  /**
   * Generates a unique external ID for deduplication.
   */
  private generateExternalId(
    date: Date,
    amount: number,
    dc_mark: string,
    reference: string,
  ): string {
    const raw = `${date.toISOString()}|${dc_mark}|${amount}|${reference}`;
    return createHash('sha256').update(raw).digest('hex').substring(0, 16);
  }
}
