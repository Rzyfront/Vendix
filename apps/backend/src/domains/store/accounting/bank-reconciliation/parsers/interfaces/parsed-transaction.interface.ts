export interface ParsedTransaction {
  date: Date;
  value_date?: Date;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  external_id?: string;
  counterparty?: string;
}

export interface StatementParseResult {
  transactions: ParsedTransaction[];
  account_number?: string;
  statement_date?: Date;
  opening_balance?: number;
  closing_balance?: number;
  errors: string[];
}

export interface ColumnMappingConfig {
  date_column: string;
  description_column: string;
  amount_column?: string;
  debit_column?: string;
  credit_column?: string;
  reference_column?: string;
  external_id_column?: string;
  counterparty_column?: string;
  date_format?: string;
  decimal_separator?: '.' | ',';
  skip_rows?: number;
}
