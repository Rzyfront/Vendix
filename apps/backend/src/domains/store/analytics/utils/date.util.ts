/**
 * Shared date utilities for analytics services.
 * All date operations use UTC methods to avoid timezone-related bugs.
 */
import { DatePreset, Granularity } from '../dto/analytics-query.dto';

export function formatPeriodFromDate(date: Date, granularity: Granularity): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');

  switch (granularity) {
    case Granularity.HOUR:
      return `${y}-${m}-${d}T${String(date.getUTCHours()).padStart(2, '0')}:00`;
    case Granularity.DAY:
      return `${y}-${m}-${d}`;
    case Granularity.WEEK:
      return `${y}-${m}-${d}`;
    case Granularity.MONTH:
      return `${y}-${m}`;
    case Granularity.YEAR:
      return `${y}`;
    default:
      return `${y}-${m}-${d}`;
  }
}

export function parseDateRange(query: {
  date_from?: string;
  date_to?: string;
  date_preset?: DatePreset;
}): { startDate: Date; endDate: Date } {
  if (query.date_from && query.date_to) {
    const endDate = new Date(query.date_to);
    endDate.setUTCHours(23, 59, 59, 999);
    return {
      startDate: new Date(query.date_from),
      endDate,
    };
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (query.date_preset) {
    case DatePreset.TODAY:
      return { startDate: today, endDate: now };
    case DatePreset.YESTERDAY: {
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return { startDate: yesterday, endDate: today };
    }
    case DatePreset.THIS_WEEK: {
      const weekStart = new Date(today);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      return { startDate: weekStart, endDate: now };
    }
    case DatePreset.LAST_WEEK: {
      const lastWeekEnd = new Date(today);
      lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - lastWeekEnd.getUTCDay());
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);
      return { startDate: lastWeekStart, endDate: lastWeekEnd };
    }
    case DatePreset.LAST_MONTH: {
      const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      return { startDate: lastMonthStart, endDate: lastMonthEnd };
    }
    case DatePreset.THIS_YEAR:
      return { startDate: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), endDate: now };
    case DatePreset.LAST_YEAR:
      return {
        startDate: new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)),
        endDate: new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 31)),
      };
    case DatePreset.THIS_MONTH:
    default:
      return {
        startDate: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
        endDate: now,
      };
  }
}

export function getPreviousPeriod(
  startDate: Date,
  endDate: Date,
): { previousStartDate: Date; previousEndDate: Date } {
  const duration = endDate.getTime() - startDate.getTime();
  const previousEndDate = new Date(startDate.getTime() - 1);
  const previousStartDate = new Date(previousEndDate.getTime() - duration);
  return { previousStartDate, previousEndDate };
}

export function getDateTruncInterval(granularity: Granularity): string {
  switch (granularity) {
    case Granularity.HOUR:
      return 'hour';
    case Granularity.DAY:
      return 'day';
    case Granularity.WEEK:
      return 'week';
    case Granularity.MONTH:
      return 'month';
    case Granularity.YEAR:
      return 'year';
    default:
      return 'day';
  }
}
