import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { WorkflowLiveListener } from './workflow-live.listener';

/** P5.6: ids of what changed in the caller's store; the client re-reads over REST. */
@Controller('store/workflows/live')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class WorkflowLiveController {
  constructor(private readonly live: WorkflowLiveListener) {}

  /**
   * No `@Query()` DTO: EventSource authenticates with `?token=` and the global
   * whitelist pipe would reject that property.
   */
  @Sse('stream')
  @Permissions('store:workflows:read')
  stream(): Observable<MessageEvent> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const events$ = this.live.stream(storeId).pipe(
      map(
        (e) =>
          ({
            type: 'workflow',
            data: {
              instance_id: e.instance_id,
              ...(e.task_id ? { task_id: e.task_id } : {}),
              kind: e.kind,
            },
          }) as MessageEvent,
      ),
    );
    // Keep-alive so proxies do not idle-close the stream.
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ type: 'heartbeat', data: { at: Date.now() } }) as MessageEvent),
    );
    return merge(events$, heartbeat$);
  }
}
