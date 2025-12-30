import { Inject } from '@nestjs/common';
import { SuperAdminAuditService } from './audit.service';

export const InjectAuditService = () => Inject(SuperAdminAuditService);
