import { Inject } from '@nestjs/common';
import { AuditService } from './audit.service';

export const InjectAuditService = () => Inject(AuditService);
