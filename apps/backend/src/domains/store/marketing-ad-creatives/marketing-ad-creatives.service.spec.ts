import { MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  withSseHeartbeat,
} from './marketing-ad-creatives.service';

describe('withSseHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const collect = (src: Observable<MessageEvent>) => {
    const events: any[] = [];
    let completed = false;
    src.subscribe({
      next: (e) => events.push(JSON.parse(e.data as string)),
      complete: () => (completed = true),
    });
    return { events, isCompleted: () => completed };
  };

  it('emits a heartbeat every 15 s without data and stops after completion', () => {
    const source = new Subject<MessageEvent>();
    const { events, isCompleted } = collect(
      withSseHeartbeat(source.asObservable()),
    );

    jest.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS - 1);
    expect(events).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(events).toEqual([{ type: 'heartbeat' }]);
    jest.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(events).toHaveLength(2);

    source.next({ data: JSON.stringify({ type: 'done' }) } as MessageEvent);
    source.complete();
    expect(isCompleted()).toBe(true);
    const count = events.length;
    jest.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 4);
    expect(events).toHaveLength(count);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops heartbeats when the source errors', () => {
    const source = new Subject<MessageEvent>();
    const errors: unknown[] = [];
    withSseHeartbeat(source.asObservable()).subscribe({
      error: (e) => errors.push(e),
    });
    source.error(new Error('x'));
    expect(errors).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
