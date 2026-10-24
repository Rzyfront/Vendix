import {
  objectiveMeteredFetch,
  objectiveProviderMeter,
} from './agent-budget-context';
import { AIEngineService } from '../ai-engine.service';

it('does not change fetch or retry behavior outside an objective', async () => {
  const fetcher = jest.fn().mockResolvedValue({ status: 200 });
  const response = await objectiveMeteredFetch(fetcher as any)(
    'https://synthetic.invalid',
  );
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('observes SDK retries once each without another retry layer or payload capture', async () => {
  const retry = jest.fn();
  const usage = jest.fn();
  const dispatch = jest.fn();
  const meter = { attempts: 0, observed: false, retry, usage, dispatch };
  const fetcher = jest
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ status: 200 });
  await objectiveProviderMeter.run(meter, async () => {
    const fetch = objectiveMeteredFetch(fetcher as any);
    await expect(fetch('https://synthetic.invalid')).rejects.toThrow('network');
    await fetch('https://synthetic.invalid');
  });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(usage).not.toHaveBeenCalled();
});
it('Engine dispatch meters actual application retries and sub-agent usage without tracing flag', async () => {
  const log = { calculateCost: jest.fn().mockReturnValue(0.02) };
  const engine = new AIEngineService(
    {} as any,
    {} as any,
    {} as any,
    log as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (engine as any).configSettings.set(1, { pricing: { input_per_1k: 0.1 } });
  const meter = {
    attempts: 0,
    observed: false,
    retry: jest.fn(),
    usage: jest.fn(),
    dispatch: jest.fn(),
  };
  const response = {
    success: false,
    usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
  };
  await objectiveProviderMeter.run(meter, () =>
    (engine as any).observeProviderAttempt(1, [], {}, async () => response),
  );
  expect(meter.dispatch).toHaveBeenCalledTimes(1);
  expect(meter.usage).toHaveBeenCalledWith(response.usage, 0.02);
  expect(meter.observed).toBe(true);
});
