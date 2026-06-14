/**
 * Stage context — passed to every stage.
 */

import type { PrismaClient } from '@prisma/client';
import type { Rng } from '../lib/random';

export interface CliOptions {
  only?: string[];
  skip?: string[];
  monthsBack: number;
  reset: boolean;
  verbose: boolean;
  seed: number;
  allowProdDb: boolean;
}

export interface StageContext {
  prisma: PrismaClient;
  options: CliOptions;
  today: Date;
  rng: Rng;
  log: (msg: string) => void;
  data: StageData;
}

export interface StageData {
  // Filled progressively by stages and consumed by later stages.
  organization?: any;
  store?: any;
  defaultLocation?: any;
  showroomLocation?: any;
  accountingEntity?: any;
  fiscalPeriods?: any[];
  categories?: any[];
  brands?: any[];
  products?: any[];
  variants?: any[];
  priceTiers?: any[];
  taxCategories?: Record<string, any>;
  taxRates?: Record<string, any>;
  employees?: any[];
  customers?: any[];
  suppliers?: any[];
  adminUser?: any;
  posCashier?: any;
  bookkeepingUser?: any;
  purchaseOrders?: any[];
  orders?: any[];
  invoices?: any[];
  fiscalPeriodByLabel?: Map<string, any>;
  withholdingConcepts?: any[];
  dianConfig?: any;
  invoiceResolution?: any;
}

export interface StageResult {
  name: string;
  ok: boolean;
  error?: string;
  counts: Record<string, number>;
}

export interface Stage {
  id: string;
  name: string;
  description: string;
  run: (ctx: StageContext) => Promise<Record<string, number>>;
}
