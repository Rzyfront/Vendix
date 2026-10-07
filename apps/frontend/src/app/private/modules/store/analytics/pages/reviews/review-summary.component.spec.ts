import { isSignal, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { EMPTY, Observable, Subject, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { ReviewSummaryComponent } from './review-summary.component';
import { AnalyticsService, RatingTrendPoint, ReviewsSummary } from '../../services/analytics.service';
import { ApiResponse } from '../../interfaces/analytics.interface';

const SUMMARY: ReviewsSummary = {
  total_reviews: 8,
  total_reviews_growth: 100,
  average_rating: 4.5,
  average_rating_growth: 12.5,
  verified_purchases: 2,
  verified_purchase_rate: 50,
  pending_reviews: 3,
  approved_reviews: 4,
  rejected_reviews: 1,
  rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 2 },
  total_helpful_votes: 5,
};
const TREND: RatingTrendPoint[] = [
  { period: '2026-07-08', average_rating: 4.5, review_count: 4 },
];
const response = <T>(data: T): ApiResponse<T> => ({ success: true, data });

// Real Angular signals/DestroyRef and RxJS; no Zone/fakeAsync or heavyweight charts.
describe('ReviewSummaryComponent independent review loads', () => {
  let component: ReviewSummaryComponent;
  let api: jasmine.SpyObj<Pick<AnalyticsService, 'getReviewsSummary' | 'getRatingTrend'>>;
  let summaries: Subject<ApiResponse<ReviewsSummary>>[];
  let trends: Subject<ApiResponse<RatingTrendPoint[]>>[];

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-07-08T15:00:00.000Z'));
    summaries = [];
    trends = [];
    api = jasmine.createSpyObj('AnalyticsService', ['getReviewsSummary', 'getRatingTrend']);
    api.getReviewsSummary.and.callFake(() => {
      const request = new Subject<ApiResponse<ReviewsSummary>>();
      summaries.push(request);
      return request;
    });
    api.getRatingTrend.and.callFake(() => {
      const request = new Subject<ApiResponse<RatingTrendPoint[]>>();
      trends.push(request);
      return request;
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AnalyticsService, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ReviewSummaryComponent());
  });

  afterEach(() => {
    try {
      TestBed.resetTestingModule();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('uses actual Angular signals and starts both requests on init', () => {
    component.ngOnInit();
    expect(isSignal(component.summary)).toBeTrue();
    expect(isSignal(component.trendLoading)).toBeTrue();
    expect(component.loading()).toBeTrue();
    expect(component.trendLoading()).toBeTrue();
    expect(api.getReviewsSummary).toHaveBeenCalledTimes(1);
    expect(api.getRatingTrend).toHaveBeenCalledTimes(1);
  });

  it('makes summary KPIs/charts available before a slow trend finishes', () => {
    component.loadData();
    summaries[0].next(response(SUMMARY));
    expect(component.summary()).toEqual(SUMMARY);
    expect(component.loading()).toBeFalse();
    expect(component.summaryError()).toBeFalse();
    expect(component.ratingDistributionChartOptions().series).toBeDefined();
    expect(component.reviewsStatusChartOptions().series).toBeDefined();
    expect(component.trendLoading()).toBeTrue();
    expect(component.ratingTrend()).toEqual([]);
  });

  it('does not require observable completion before exposing the summary', () => {
    component.loadData();
    summaries[0].next(response(SUMMARY));
    expect(component.loading()).toBeFalse();
    expect(summaries[0].observed).toBeFalse();
  });

  it('allows trend/chart success before the summary', () => {
    component.loadData();
    trends[0].next(response(TREND));
    expect(component.trendLoading()).toBeFalse();
    expect(component.ratingTrend()).toEqual(TREND);
    expect(component.ratingTrendChartOptions().series).toBeDefined();
    expect(component.loading()).toBeTrue();
    expect(component.summary()).toBeNull();
  });

  it('keeps successful summary data and reports a later trend error', () => {
    component.loadData();
    summaries[0].next(response(SUMMARY));
    trends[0].error(new Error('trend 503'));
    expect(component.summary()).toEqual(SUMMARY);
    expect(component.summaryError()).toBeFalse();
    expect(component.trendError()).toBeTrue();
    expect(component.trendLoading()).toBeFalse();
    expect(component.ratingTrendChartOptions()).toEqual({});
  });

  it('still loads the summary when the trend fails first', () => {
    component.loadData();
    trends[0].error(new Error('trend network'));
    expect(summaries[0].observed).toBeTrue();
    summaries[0].next(response(SUMMARY));
    expect(component.summary()).toEqual(SUMMARY);
    expect(component.loading()).toBeFalse();
    expect(component.trendError()).toBeTrue();
  });

  it('shows summary failure instead of fabricated zero KPIs, retaining a successful trend', () => {
    component.loadData();
    trends[0].next(response(TREND));
    summaries[0].error(new Error('summary 503'));
    expect(component.summary()).toBeNull();
    expect(component.summaryError()).toBeTrue();
    expect(component.loading()).toBeFalse();
    expect(component.ratingDistributionChartOptions()).toEqual({});
    expect(component.reviewsStatusChartOptions()).toEqual({});
    expect(component.ratingTrend()).toEqual(TREND);
    expect(component.trendError()).toBeFalse();
  });

  it('continues loading the trend after a summary error', () => {
    component.loadData();
    summaries[0].error(new Error('summary network'));
    expect(trends[0].observed).toBeTrue();
    expect(component.trendLoading()).toBeTrue();
    trends[0].next(response(TREND));
    expect(component.ratingTrendChartOptions().series).toBeDefined();
    expect(component.trendLoading()).toBeFalse();
  });

  it('ends both loading states with explicit independent errors when both fail', () => {
    component.loadData();
    summaries[0].error(new Error('summary'));
    trends[0].error(new Error('trend'));
    expect(component.loading()).toBeFalse();
    expect(component.trendLoading()).toBeFalse();
    expect(component.summaryError()).toBeTrue();
    expect(component.trendError()).toBeTrue();
  });

  it('treats an empty summary observable as unavailable, not loading forever', () => {
    api.getReviewsSummary.and.returnValue(EMPTY);
    component.loadData();
    expect(component.loading()).toBeFalse();
    expect(component.summaryError()).toBeTrue();
    expect(component.summary()).toBeNull();
    expect(component.trendLoading()).toBeTrue();
  });

  it('treats an empty trend observable as unavailable', () => {
    api.getRatingTrend.and.returnValue(EMPTY);
    component.loadData();
    expect(component.trendLoading()).toBeFalse();
    expect(component.trendError()).toBeTrue();
    expect(component.loading()).toBeTrue();
  });

  it('treats missing response data as an error for each load', () => {
    api.getReviewsSummary.and.returnValue(of({ success: true } as ApiResponse<ReviewsSummary>));
    api.getRatingTrend.and.returnValue(of({ success: true } as ApiResponse<RatingTrendPoint[]>));
    component.loadData();
    expect(component.summaryError()).toBeTrue();
    expect(component.trendError()).toBeTrue();
    expect(component.loading()).toBeFalse();
    expect(component.trendLoading()).toBeFalse();
  });

  it('accepts a valid empty trend without reporting failure', () => {
    component.loadData();
    trends[0].next(response([]));
    expect(component.ratingTrend()).toEqual([]);
    expect(component.trendError()).toBeFalse();
    expect(component.trendLoading()).toBeFalse();
    expect(component.ratingTrendChartOptions().series).toBeDefined();
  });

  it('accepts genuine zero counts without confusing them with summary failure', () => {
    component.loadData();
    const empty = { ...SUMMARY, total_reviews: 0, approved_reviews: 0, average_rating: 0, average_rating_growth: null, total_reviews_growth: -100, verified_purchase_rate: null };
    summaries[0].next(response(empty));
    expect(component.summary()).toEqual(empty);
    expect(component.summaryError()).toBeFalse();
    expect(component.averageRatingGrowthText()).toContain('Sin base de comparación');
    expect(component.totalReviewsGrowthText()).toContain('-100.0%');
    expect(component.verifiedPurchaseRateText()).toBe('—');
  });

  it('handles both synchronous responses without leaving either spinner on', () => {
    api.getReviewsSummary.and.returnValue(of(response(SUMMARY)));
    api.getRatingTrend.and.returnValue(of(response(TREND)));
    component.loadData();
    expect(component.summary()).toEqual(SUMMARY);
    expect(component.ratingTrend()).toEqual(TREND);
    expect(component.loading()).toBeFalse();
    expect(component.trendLoading()).toBeFalse();
  });

  it('cancels both old requests and ignores stale success/error after a filter change', () => {
    component.loadData();
    component.onFilterChange({ date_range_start: '2026-06-01', date_range_end: '2026-06-30', date_range_preset: 'lastMonth' });
    expect(summaries[0].observed).toBeFalse();
    expect(trends[0].observed).toBeFalse();
    summaries[0].next(response(SUMMARY));
    trends[0].error(new Error('stale'));
    expect(component.summary()).toBeNull();
    expect(component.loading()).toBeTrue();
    expect(component.trendLoading()).toBeTrue();
    expect(component.trendError()).toBeFalse();
    summaries[1].next(response({ ...SUMMARY, total_reviews: 2 }));
    trends[1].next(response([]));
    expect(component.summary()?.total_reviews).toBe(2);
    expect(component.ratingTrend()).toEqual([]);
  });

  it('clears previous successful data/charts while loading a new range', () => {
    component.loadData();
    summaries[0].next(response(SUMMARY));
    trends[0].next(response(TREND));
    component.onClearAllFilters();
    expect(component.summary()).toBeNull();
    expect(component.ratingTrend()).toEqual([]);
    expect(component.ratingDistributionChartOptions()).toEqual({});
    expect(component.reviewsStatusChartOptions()).toEqual({});
    expect(component.ratingTrendChartOptions()).toEqual({});
    expect(component.loading()).toBeTrue();
    expect(component.trendLoading()).toBeTrue();
  });

  it('clears errors and recovers each section independently on retry', () => {
    component.loadData();
    summaries[0].error(new Error('summary'));
    trends[0].error(new Error('trend'));
    component.loadData();
    expect(component.summaryError()).toBeFalse();
    expect(component.trendError()).toBeFalse();
    summaries[1].next(response(SUMMARY));
    expect(component.loading()).toBeFalse();
    expect(component.trendLoading()).toBeTrue();
    trends[1].next(response(TREND));
    expect(component.trendLoading()).toBeFalse();
  });

  it('captures one immutable date range for both requests', () => {
    component.dateRange.set({ start_date: '2026-01-01', end_date: '2026-07-08', preset: 'custom' });
    component.loadData();
    const summaryQuery = api.getReviewsSummary.calls.mostRecent().args[0];
    const trendQuery = api.getRatingTrend.calls.mostRecent().args[0];
    expect(summaryQuery.date_range).toEqual(component.dateRange());
    expect(summaryQuery.date_range).not.toBe(component.dateRange());
    expect(trendQuery.date_range).toBe(summaryQuery.date_range);
    expect(trendQuery.granularity).toBe('month');
  });

  it('ignores incomplete filters instead of starting an incoherent date request', () => {
    component.loadData();
    component.onFilterChange({ date_range_start: '2026-06-01', date_range_end: null });
    expect(api.getReviewsSummary).toHaveBeenCalledTimes(1);
    expect(api.getRatingTrend).toHaveBeenCalledTimes(1);
  });

  it('keeps only the final request pair during rapid range changes', () => {
    component.loadData();
    for (let day = 1; day <= 20; day++) {
      component.onFilterChange({ date_range_start: `2026-06-${String(day).padStart(2, '0')}`, date_range_end: '2026-06-30' });
    }
    expect(summaries.filter(request => request.observed).length).toBe(1);
    expect(trends.filter(request => request.observed).length).toBe(1);
    for (let i = 0; i < 20; i++) {
      summaries[i].next(response(SUMMARY));
      trends[i].next(response(TREND));
    }
    expect(component.summary()).toBeNull();
    summaries[20].next(response({ ...SUMMARY, total_reviews: 20 }));
    trends[20].next(response([]));
    expect(component.summary()?.total_reviews).toBe(20);
  });

  it('cleans both subscriptions on destroy and does not update or load afterward', () => {
    component.loadData();
    const oldSummary = summaries[0];
    const oldTrend = trends[0];
    TestBed.resetTestingModule();
    expect(oldSummary.observed).toBeFalse();
    expect(oldTrend.observed).toBeFalse();
    oldSummary.next(response(SUMMARY));
    oldTrend.next(response(TREND));
    expect(component.summary()).toBeNull();
    expect(component.ratingTrend()).toEqual([]);
    component.loadData();
    expect(api.getReviewsSummary).toHaveBeenCalledTimes(1);
    expect(api.getRatingTrend).toHaveBeenCalledTimes(1);
  });

  it('uses controlled RxJS timers to expose KPIs at 100ms and trend at 300ms', () => {
    api.getReviewsSummary.and.returnValue(timer(100).pipe(map(() => response(SUMMARY))));
    api.getRatingTrend.and.returnValue(timer(300).pipe(map(() => response(TREND))));
    component.loadData();
    jasmine.clock().tick(100);
    expect(component.summary()).toEqual(SUMMARY);
    expect(component.loading()).toBeFalse();
    expect(component.trendLoading()).toBeTrue();
    jasmine.clock().tick(200);
    expect(component.ratingTrend()).toEqual(TREND);
    expect(component.trendLoading()).toBeFalse();
  });

  it('runs teardown for delayed work on both range changes and destroy', () => {
    const teardown = jasmine.createSpy('teardown');
    const delayed = <T>(data: T): Observable<ApiResponse<T>> => new Observable(subscriber => {
      const handle = setTimeout(() => { subscriber.next(response(data)); subscriber.complete(); }, 100);
      return () => { clearTimeout(handle); teardown(); };
    });
    api.getReviewsSummary.and.returnValue(delayed(SUMMARY));
    api.getRatingTrend.and.returnValue(delayed(TREND));
    component.loadData();
    component.loadData();
    expect(teardown).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
    expect(teardown).toHaveBeenCalledTimes(4);
    jasmine.clock().tick(1000);
    expect(component.summary()).toBeNull();
    expect(component.ratingTrend()).toEqual([]);
  });
});
