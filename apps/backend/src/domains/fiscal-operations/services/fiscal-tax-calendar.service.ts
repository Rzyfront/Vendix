import { BadRequestException, Injectable } from '@nestjs/common';
import { fiscal_obligation_type_enum } from '@prisma/client';
import { FISCAL_CLOSE_TYPES, FiscalCloseType } from './fiscal-period.util';
import {
  DIAN_2026_RETENTION_MONTHLY_DUE_DAYS,
  DIAN_2026_VAT_BIMONTHLY_DUE_DAYS,
  DIAN_2026_VAT_FOUR_MONTHLY_DUE_DAYS,
  DIAN_TAX_CALENDAR_2026_SOURCE_URL,
  DIAN_TAX_CALENDAR_2026_VERSION,
  NitBaseLastDigit,
} from '../constants/fiscal-tax-calendar-2026';

export interface ConfiguredFiscalDeadlineOverride {
  date: string;
  source: string;
  verified: boolean;
}

export interface ResolveFiscalTaxCalendarInput {
  type: fiscal_obligation_type_enum;
  period_year: number;
  /** Closing month of the fiscal period (e.g. 2 = January-February). */
  period_month?: number | null;
  periodicity?: FiscalCloseType | null;
  /** Base NIT, or NIT with an optional dotted/hyphenated verification digit. */
  nit: string;
  jurisdiction_key: string;
  taxpayer_regime?: string | null;
  configured_deadline_override?: ConfiguredFiscalDeadlineOverride | null;
}

export interface FiscalTaxCalendarResolution {
  due_date: Date | null;
  due_date_verified: boolean;
  due_date_source: string | null;
  warning: string | null;
}

const CALENDAR_SOURCE = `DIAN Calendario Tributario ${DIAN_TAX_CALENDAR_2026_VERSION}: ${DIAN_TAX_CALENDAR_2026_SOURCE_URL}`;
const ORDINARY_REGIMES = new Set([
  'COMUN',
  'REGIMEN COMUN',
  'ORDINARY',
  'GENERAL',
  'REGIMEN GENERAL',
  'ORDINARIO',
  'REGIMEN ORDINARIO',
]);
const SUPPORTED_BIMONTHLY_CLOSINGS = new Set<number>([2, 4, 6, 8, 10, 12]);
const SUPPORTED_FOUR_MONTHLY_CLOSINGS = new Set<number>([4, 8, 12]);

function isNitBaseLastDigit(value: number): value is NitBaseLastDigit {
  return Number.isInteger(value) && value >= 0 && value <= 9;
}

@Injectable()
export class FiscalTaxCalendarService {
  resolve(
    input: ResolveFiscalTaxCalendarInput,
  ): FiscalTaxCalendarResolution {
    this.validatePeriod(input);
    const nitDigit = this.resolveNitBaseLastDigit(input.nit);

    if (input.configured_deadline_override != null) {
      return this.resolveOverride(input.configured_deadline_override);
    }

    if (this.isSpecialOrUnknownRegime(input.taxpayer_regime)) {
      return this.unknown(
        'A verified DIAN deadline is unavailable for this taxpayer regime.',
      );
    }
    if (input.jurisdiction_key !== 'CO-DIAN') {
      return this.unknown(
        'No verified calendar is available for this jurisdiction.',
      );
    }
    if (input.period_year !== 2026) {
      return this.unknown(
        `No verified DIAN tax calendar is available for ${input.period_year}.`,
      );
    }

    const closingMonth = input.period_month ?? null;
    const dueDay = this.resolveDueDay(input, nitDigit, closingMonth);
    if (dueDay == null || closingMonth == null) {
      return this.unknown(
        'No verified DIAN deadline is available for this obligation and periodicity.',
      );
    }

    const dueYear = closingMonth === 12 ? input.period_year + 1 : input.period_year;
    const dueMonth = closingMonth === 12 ? 1 : closingMonth + 1;
    return {
      due_date: new Date(Date.UTC(dueYear, dueMonth - 1, dueDay)),
      due_date_verified: true,
      due_date_source: CALENDAR_SOURCE,
      warning: null,
    };
  }

  private validatePeriod(input: ResolveFiscalTaxCalendarInput): void {
    if (!Number.isInteger(input.period_year) || input.period_year < 1 || input.period_year > 9999) {
      throw new BadRequestException('period_year must be an integer from 1 through 9999');
    }
    if (
      input.period_month != null &&
      (!Number.isInteger(input.period_month) ||
        input.period_month < 1 ||
        input.period_month > 12)
    ) {
      throw new BadRequestException('period_month must be an integer from 1 through 12');
    }
    if (input.periodicity != null && !FISCAL_CLOSE_TYPES.includes(input.periodicity)) {
      throw new BadRequestException('Unsupported fiscal periodicity');
    }
    if (
      !Object.values(fiscal_obligation_type_enum).includes(input.type)
    ) {
      throw new BadRequestException('Unsupported fiscal obligation type');
    }
    if (
      input.taxpayer_regime != null &&
      typeof input.taxpayer_regime !== 'string'
    ) {
      throw new BadRequestException('taxpayer_regime must be a string');
    }
    if (typeof input.jurisdiction_key !== 'string' || !input.jurisdiction_key.trim()) {
      throw new BadRequestException('jurisdiction_key is required');
    }
    if (input.periodicity === 'annual') {
      if (input.period_month != null) {
        throw new BadRequestException('period_month must be empty for annual periodicity');
      }
      return;
    }
    if (input.periodicity != null && input.period_month == null) {
      throw new BadRequestException(
        `period_month is required for ${input.periodicity} periodicity`,
      );
    }
    if (
      input.periodicity === 'bimonthly' &&
      input.period_month != null &&
      !SUPPORTED_BIMONTHLY_CLOSINGS.has(input.period_month)
    ) {
      throw new BadRequestException('Bimonthly periods must close in an even month');
    }
    if (
      input.periodicity === 'four_monthly' &&
      input.period_month != null &&
      !SUPPORTED_FOUR_MONTHLY_CLOSINGS.has(input.period_month)
    ) {
      throw new BadRequestException('Four-month periods must close in April, August, or December');
    }
  }

  private resolveDueDay(
    input: ResolveFiscalTaxCalendarInput,
    nitDigit: NitBaseLastDigit,
    closingMonth: number | null,
  ): number | null {
    if (closingMonth == null) return null;

    if (input.type === 'vat_return') {
      if (input.periodicity === 'bimonthly') {
        return DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[
          closingMonth
        ]?.[nitDigit] ?? null;
      }
      if (input.periodicity === 'four_monthly') {
        return DIAN_2026_VAT_FOUR_MONTHLY_DUE_DAYS[
          closingMonth
        ]?.[nitDigit] ?? null;
      }
      return null;
    }

    if (input.type === 'inc_return' && input.periodicity === 'bimonthly') {
      return DIAN_2026_VAT_BIMONTHLY_DUE_DAYS[
        closingMonth
      ]?.[nitDigit] ?? null;
    }

    if (
      (input.type === 'withholding_return' || input.type === 'reteiva_return') &&
      input.periodicity === 'monthly'
    ) {
      return DIAN_2026_RETENTION_MONTHLY_DUE_DAYS[
        closingMonth
      ]?.[nitDigit] ?? null;
    }

    return null;
  }

  private resolveNitBaseLastDigit(nit: string): NitBaseLastDigit {
    if (typeof nit !== 'string' || !nit.trim()) {
      throw new BadRequestException('NIT is required to resolve the DIAN calendar');
    }

    const trimmed = nit.trim();
    if (
      !/^\d+(?:-\d)?$/.test(trimmed) &&
      !/^\d{1,3}(?:\.\d{3})+(?:-\d)?$/.test(trimmed)
    ) {
      throw new BadRequestException(
        'NIT must be digits or dotted digits with an optional hyphenated verification digit',
      );
    }
    const hyphenIndex = trimmed.lastIndexOf('-');
    let basePart = trimmed;
    if (hyphenIndex >= 0) {
      const verificationDigit = trimmed.slice(hyphenIndex + 1);
      if (!/^\d$/.test(verificationDigit)) {
        throw new BadRequestException('NIT verification digit must be one digit');
      }
      basePart = trimmed.slice(0, hyphenIndex);
    }
    const baseDigits = basePart.replace(/\./g, '');
    if (!baseDigits) throw new BadRequestException('NIT must contain digits');
    const digit = Number(baseDigits[baseDigits.length - 1]);
    if (!isNitBaseLastDigit(digit)) {
      throw new BadRequestException('NIT base must end in one digit');
    }
    return digit;
  }

  private resolveOverride(
    override: ConfiguredFiscalDeadlineOverride,
  ): FiscalTaxCalendarResolution {
    if (
      override == null ||
      typeof override !== 'object' ||
      typeof override.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(override.date) ||
      typeof override.source !== 'string' ||
      !override.source.trim() ||
      typeof override.verified !== 'boolean'
    ) {
      throw new BadRequestException(
        'Configured deadline override requires an ISO date, source, and verified flag',
      );
    }
    const date = new Date(`${override.date}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() < 1 ||
      date.toISOString().slice(0, 10) !== override.date
    ) {
      throw new BadRequestException('Configured deadline override date is invalid');
    }
    return {
      due_date: date,
      due_date_verified: override.verified,
      due_date_source: override.source.trim(),
      warning: override.verified
        ? null
        : 'Configured deadline is explicitly unverified; confirm it with the authoritative tax calendar.',
    };
  }

  private isSpecialOrUnknownRegime(regime?: string | null): boolean {
    if (regime == null || regime.trim() === '') return false;
    const normalized = regime
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return !ORDINARY_REGIMES.has(normalized);
  }

  private unknown(warning: string): FiscalTaxCalendarResolution {
    return {
      due_date: null,
      due_date_verified: false,
      due_date_source: null,
      warning,
    };
  }
}
