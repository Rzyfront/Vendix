import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestContextService } from '../context/request-context.service';

export const RequestContext = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const context = RequestContextService.getContext();

    return data ? context?.[data] : context;
  },
);
