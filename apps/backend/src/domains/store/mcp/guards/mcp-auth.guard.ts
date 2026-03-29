import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { McpAuthService, McpTokenPayload } from '../mcp-auth.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly mcpAuth: McpAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers?.authorization;
    const queryToken = request.query?.token;

    let token: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      throw new VendixHttpException(ErrorCodes.AI_MCP_001, 'No authentication token provided');
    }

    const payload: McpTokenPayload = await this.mcpAuth.validateToken(token);
    await this.mcpAuth.checkRateLimit(payload.store_id);

    // Set on request.mcpAuth for audit service
    request.mcpAuth = payload;

    // Set on request.user so RequestContextInterceptor picks it up naturally
    request.user = {
      user_id: payload.user_id,
      organization_id: payload.organization_id,
      store_id: payload.store_id,
      roles: payload.roles,
      is_super_admin: false,
      is_owner: false,
    };

    return true;
  }
}
