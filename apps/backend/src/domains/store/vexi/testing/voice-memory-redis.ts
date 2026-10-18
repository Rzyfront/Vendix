/** Synthetic Redis command model: covers atomic interleavings, not real Redis Lua. */
export class MemoryRedis {
  readonly values = new Map<string, { value: string; expiresAt: number }>();
  readonly scripts: string[] = [];
  async set(
    key: string,
    value: string,
    mode: string,
    ttl: number,
  ): Promise<string> {
    this.values.set(key, {
      value,
      expiresAt: Date.now() + Number(ttl) * (mode === 'EX' ? 1_000 : 1),
    });
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.read(key);
  }
  private read(key: string): string | null {
    const item = this.values.get(key);
    if (!item || item.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return item.value;
  }
  async eval(
    script: string,
    count: number,
    ...params: Array<string | number>
  ): Promise<unknown> {
    this.scripts.push(script);
    const keys = params.slice(0, count).map(String);
    const args = params.slice(count).map(String);
    if (script.includes('voice_click_claim')) {
      if (this.read(keys[0]) !== args[0] || this.read(keys[1]) !== args[1])
        return 0;
      this.values.delete(keys[0]);
      return 1;
    }
    // No await before this synthetic command finishes: one atomic Redis turn.
    if (script.includes('return {1, ttl,')) {
      const value = this.read(keys[0]);
      if (!value) return [0, 0, ''];
      if (value !== args[0]) return [-1, 0, ''];
      const ttl = Math.floor(
        (this.values.get(keys[0])!.expiresAt - Date.now()) / 1_000,
      );
      return ttl > 0 ? [1, ttl, this.read(keys[1]) ?? ''] : [0, 0, ''];
    }
    if (script.includes("'EX', ARGV[3]")) {
      this.values.set(keys[0], {
        value: args[0],
        expiresAt: Date.now() + Number(args[2]) * 1_000,
      });
      this.values.set(keys[1], {
        value: args[1],
        expiresAt: Date.now() + Number(args[2]) * 1_000,
      });
      return 1;
    }
    if (count === 1) {
      const value = this.read(keys[0]);
      if (!value) return 0;
      if (value !== args[0]) return -1;
      this.values.delete(keys[0]);
      return 1;
    }
    if (this.read(keys[0]) !== args[0]) return 0;
    if (script.includes("'PX', ttl")) {
      const expiresAt = this.values.get(keys[0])!.expiresAt;
      this.values.set(keys[0], { value: args[1], expiresAt });
      this.values.delete(keys[1]);
      return 1;
    }
    if (count === 2) {
      this.values.delete(keys[0]);
      this.values.delete(keys[1]);
      return 1;
    }
    if (script.includes("redis.call('SET', KEYS[3]")) {
      if (args[5] !== '' && this.read(keys[3]) !== args[5]) return 0;
      const expiresAt = Date.now() + Number(args[3]);
      this.values.set(keys[1], { value: args[1], expiresAt });
      this.values.set(keys[2], { value: args[2], expiresAt });
      this.values.set(keys[3], { value: args[4], expiresAt });
      return 1;
    }
    if (this.read(keys[1]) !== args[1] || this.read(keys[2]) !== args[2])
      return 0;
    if (
      count === 5 &&
      this.read(keys[4]) !==
        args[script.includes('KEYS[5]) ~= ARGV[6]') ? 5 : 4]
    )
      return 0;
    if (script.includes("redis.call('SET', KEYS[4]")) {
      this.values.set(keys[3], {
        value: args[3],
        expiresAt: Date.now() + Number(args[4]),
      });
      return 1;
    }
    if (this.read(keys[3]) !== args[3]) return 0;
    if (script.includes("redis.call('DEL', KEYS[4])")) {
      this.values.delete(keys[3]);
      return 1;
    }
    this.values.delete(keys[1]);
    this.values.delete(keys[2]);
    this.values.delete(keys[3]);
    return 1;
  }
}
