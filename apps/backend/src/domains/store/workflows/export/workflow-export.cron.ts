import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { EXPORT_STALE_HOURS, WorkflowExportService } from './workflow-export.service';

export const EXPORT_PROCESS_LOCK = 'workflows:export:process:lock';
export const EXPORT_EXPIRE_LOCK = 'workflows:export:expire:lock';
const PROCESS_LOCK_SECONDS = 5 * 60;
const HEARTBEAT_MS = 60 * 1000;
const EXPIRE_LOCK_SECONDS = 50 * 60;
/** A build still running past this is given up; `failStale` uses the same limit. */
const RUN_LIMIT_MS = EXPORT_STALE_HOURS * 60 * 60 * 1000;

/** Deletes the lock only while it is still ours. */
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/**
 * Background side of the Flows export (P7.6). Runs only in the worker (the API
 * unmounts crons). A Redis lock keeps two instances from building at once, and
 * the in-process flag keeps one export at a time per process; the claim itself
 * is atomic in the database.
 */
@Injectable()
export class WorkflowExportCron {
  private readonly logger = new Logger(WorkflowExportCron.name);
  private processing = false;
  private expiring = false;

  constructor(
    private readonly exports: WorkflowExportService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Every minute: one pending export. The lock lives while it builds, but
   * never past `EXPORT_STALE_HOURS`: a build stuck that long stops holding the
   * lock (and this process), so the queue of every other store moves on and
   * the next run marks the stuck export failed.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const token = randomUUID();
    let heartbeat: NodeJS.Timeout | null = null;
    let giveUp: NodeJS.Timeout | undefined;
    try {
      const claimed = await this.redis.set(EXPORT_PROCESS_LOCK, token, 'EX', PROCESS_LOCK_SECONDS, 'NX');
      if (claimed !== 'OK') return;
      const deadline = Date.now() + RUN_LIMIT_MS;
      heartbeat = setInterval(() => {
        if (Date.now() >= deadline) return;
        this.redis.expire(EXPORT_PROCESS_LOCK, PROCESS_LOCK_SECONDS).catch(() => undefined);
      }, HEARTBEAT_MS);
      heartbeat.unref();
      await this.exports.failStale(new Date());
      const timedOut = new Promise<'timed_out'>((resolve) => {
        giveUp = setTimeout(() => resolve('timed_out'), RUN_LIMIT_MS);
        giveUp.unref();
      });
      if ((await Promise.race([this.exports.processNext(), timedOut])) === 'timed_out') {
        this.logger.error(
          `Workflow export run passed ${EXPORT_STALE_HOURS} h; it is given up and the next run marks it failed`,
        );
      }
    } catch (e) {
      this.logger.error(`Workflow export run failed: ${(e as Error)?.message}`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(giveUp);
      await this.redis.eval(RELEASE_SCRIPT, 1, EXPORT_PROCESS_LOCK, token).catch(() => undefined);
      this.processing = false;
    }
  }

  /** Hourly: ready exports past their expiry lose their object. */
  @Cron(CronExpression.EVERY_HOUR)
  async expire(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    try {
      const claimed = await this.redis.set(EXPORT_EXPIRE_LOCK, '1', 'EX', EXPIRE_LOCK_SECONDS, 'NX');
      if (claimed !== 'OK') return;
      await this.exports.expireDue(new Date());
    } catch (e) {
      this.logger.error(`Workflow export expiry failed: ${(e as Error)?.message}`);
    } finally {
      this.expiring = false;
    }
  }
}
