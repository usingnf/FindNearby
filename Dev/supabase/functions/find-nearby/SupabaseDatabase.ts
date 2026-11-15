export class DatabaseError extends Error {
  constructor() {
    super('데이터베이스에 연결할 수 없습니다.');
  }
}

export class SupabaseDatabase {
  constructor(private readonly url: string, private readonly key: string) {}

  async rpc<T>(name: string, args: object = {}, timeout = 4000): Promise<T> {
    if (!this.url || !this.key) throw new DatabaseError();
    const headers: Record<string, string> = {
      apikey: this.key,
      'Content-Type': 'application/json',
    };
    if (!this.key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + this.key;
    try {
      const response = await fetch(new URL('/rest/v1/rpc/' + name, this.url), {
        method: 'POST', headers, body: JSON.stringify(args),
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeout))),
        redirect: 'error',
      });
      if (!response.ok) throw new DatabaseError();
      return await response.json() as T;
    } catch {
      throw new DatabaseError();
    }
  }
}
