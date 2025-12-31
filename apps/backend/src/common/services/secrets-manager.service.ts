import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
} from '@aws-sdk/client-secrets-manager';

@Injectable()
export class SecretsManagerService implements OnModuleInit {
  private readonly logger = new Logger(SecretsManagerService.name);
  private readonly client: SecretsManagerClient;
  private secretsCache: Record<string, any> = {};
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 300000; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';

    const clientConfig: any = {
      region,
    };

    // Use IAM Role or explicit credentials (same pattern as S3Service)
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
    }

    this.client = new SecretsManagerClient(clientConfig);
  }

  async onModuleInit() {
    // Pre-load secrets on startup
    if (this.shouldUseSecretsManager()) {
      this.logger.log('Initializing AWS Secrets Manager...');
      try {
        await this.loadSecrets();
        this.loadSecretsToEnv();
        this.logger.log('AWS Secrets Manager loaded successfully');
      } catch (error) {
        this.logger.error(`Failed to load secrets from AWS Secrets Manager: ${error.message}`);

        // In production, this should fail fast
        const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
        if (nodeEnv === 'production') {
          throw new Error('Cannot start production application without AWS Secrets Manager');
        }

        // In development, warn and continue with .env
        this.logger.warn('Falling back to environment variables for development');
      }
    } else {
      this.logger.log('Secrets Manager disabled, using .env files');
    }
  }

  private shouldUseSecretsManager(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const useSecrets = this.configService.get<string>('USE_SECRETS_MANAGER', 'false');

    // Use Secrets Manager in production or explicitly enabled
    return nodeEnv === 'production' || useSecrets === 'true';
  }

  private async loadSecrets(): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const secretCategories = ['database', 'jwt', 'email', 'aws', 'app'];

    for (const category of secretCategories) {
      try {
        const secretName = `vendix/${nodeEnv}/${category}`;
        const params: GetSecretValueCommandInput = {
          SecretId: secretName,
        };

        const command = new GetSecretValueCommand(params);
        const response = await this.client.send(command);

        if (response.SecretString) {
          const secretData = JSON.parse(response.SecretString);
          this.secretsCache = { ...this.secretsCache, ...secretData };
          this.logger.log(`Secret loaded: ${secretName}`);
        }
      } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
          this.logger.warn(`Secret not found: vendix/${nodeEnv}/${category}`);
        } else {
          throw error;
        }
      }
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL;
  }

  // Bulk load all secrets into environment
  loadSecretsToEnv(): void {
    if (!this.shouldUseSecretsManager()) {
      return;
    }

    for (const [key, value] of Object.entries(this.secretsCache)) {
      if (value && (typeof value === 'string' || typeof value === 'number')) {
        process.env[key] = String(value);
      }
    }

    this.logger.log(`Loaded ${Object.keys(this.secretsCache).length} secrets into environment variables`);
  }

  async getSecret(key: string): Promise<string | undefined> {
    // Check cache expiry
    if (Date.now() > this.cacheExpiry && this.shouldUseSecretsManager()) {
      this.logger.log('Cache expired, refreshing secrets...');
      await this.loadSecrets();
      this.loadSecretsToEnv();
    }

    return this.secretsCache[key];
  }

  async refreshSecrets(): Promise<void> {
    this.logger.log('Manually refreshing secrets...');
    await this.loadSecrets();
    this.loadSecretsToEnv();
  }

  getAllSecrets(): Record<string, any> {
    return { ...this.secretsCache };
  }

  isUsingSecretsManager(): boolean {
    return this.shouldUseSecretsManager();
  }

  getHealthStatus(): { usingSecretsManager: boolean; cacheExpiry: number; secretsCount: number } {
    return {
      usingSecretsManager: this.isUsingSecretsManager(),
      cacheExpiry: this.cacheExpiry,
      secretsCount: Object.keys(this.secretsCache).length,
    };
  }
}
