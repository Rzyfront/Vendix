import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { ChunkedUploadAdapter, uploadInChunks } from './workflow-chunked-upload';

function adapterFor(parts: number, put: ChunkedUploadAdapter['putPart']) {
  const adapter: jasmine.SpyObj<ChunkedUploadAdapter> = jasmine.createSpyObj('adapter', ['init', 'putPart', 'complete']);
  adapter.init.and.returnValue(of({ upload_id: 'up-1', chunk_size: 4, total_parts: parts }));
  adapter.putPart.and.callFake(put);
  adapter.complete.and.returnValue(of({}));
  return adapter;
}

describe('uploadInChunks', () => {
  const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });

  it('sends the parts in order, reports progress and completes', async () => {
    const adapter = adapterFor(3, () => of({}));
    const progress: number[] = [];
    await expectAsync(uploadInChunks(file, adapter, { onProgress: (p) => progress.push(p) })).toBeResolvedTo('up-1');
    expect(adapter.init).toHaveBeenCalledWith({ file_name: 'a.png', mime_type: 'image/png', size_bytes: 10 });
    expect(adapter.putPart.calls.allArgs().map((a) => [a[1], (a[2] as Blob).size])).toEqual([[1, 4], [2, 4], [3, 2]]);
    expect(progress).toEqual([0, 33, 67, 100, 100]);
    expect(adapter.complete).toHaveBeenCalledOnceWith('up-1');
  });

  it('retries a transient failure up to 3 times and then succeeds', async () => {
    let calls = 0;
    const adapter = adapterFor(1, () => (++calls < 4 ? throwError(() => new HttpErrorResponse({ status: 503 })) : of({})));
    await expectAsync(uploadInChunks(file, adapter, { retryDelayMs: 0 })).toBeResolvedTo('up-1');
    expect(calls).toBe(4);
  });

  it('gives up after the third retry and never completes', async () => {
    const adapter = adapterFor(1, () => throwError(() => new HttpErrorResponse({ status: 0 })));
    await expectAsync(uploadInChunks(file, adapter, { retryDelayMs: 0 })).toBeRejected();
    expect(adapter.putPart).toHaveBeenCalledTimes(4);
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('does not retry a 422', async () => {
    const adapter = adapterFor(1, () => throwError(() => new HttpErrorResponse({ status: 422 })));
    await expectAsync(uploadInChunks(file, adapter, { retryDelayMs: 0 })).toBeRejected();
    expect(adapter.putPart).toHaveBeenCalledTimes(1);
  });
});
