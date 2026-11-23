import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ChannelEncryptionService } from '../../store/integrations/channels/channel-encryption.service';
import {
  computeMetaWhatsappSignupGate,
  resolveMetaWhatsappPlatformConfig,
} from '../../store/integrations/channels/meta-whatsapp-platform-config.resolver';

/** What the public signup bridge may know: identifiers Meta's SDK needs, nothing else. */
export interface MetaWhatsappPublicSignupConfig {
  can_start_signup: boolean;
  app_id: string | null;
  whatsapp_config_id: string | null;
  graph_version: string | null;
}

@Injectable()
export class MetaWhatsappSignupConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    private readonly encryption: ChannelEncryptionService,
  ) {}

  /**
   * Public, unauthenticated: the bridge page on the fixed host has no session.
   * Never returns secrets nor which settings are missing; with the gate
   * closed it returns no identifiers at all.
   */
  async getPublicSignupConfig(): Promise<MetaWhatsappPublicSignupConfig> {
    const config = await resolveMetaWhatsappPlatformConfig(
      this.prisma,
      this.configService,
      this.encryption,
    );
    const gate = computeMetaWhatsappSignupGate(config, this.encryption.isEnabled);

    if (!gate.can_start_signup) {
      return {
        can_start_signup: false,
        app_id: null,
        whatsapp_config_id: null,
        graph_version: null,
      };
    }

    return {
      can_start_signup: true,
      app_id: config.app_id,
      whatsapp_config_id: config.whatsapp_config_id,
      graph_version: config.graph_version,
    };
  }
}
