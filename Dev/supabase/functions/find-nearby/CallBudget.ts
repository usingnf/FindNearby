import { ProviderError } from './Models.ts';
import type { SupabaseDatabase } from './SupabaseDatabase.ts';

export class SearchBudget {
  private readonly deadline: number;
  private remainingCalls: number;

  constructor(calls: number, seconds: number, readonly reserve: number) {
    this.remainingCalls = calls;
    this.deadline = performance.now() + seconds * 1000;
  }

  remainingTime(): number {
    const remaining = this.deadline - performance.now();
    if (remaining <= 0) throw new ProviderError(504, '추천 검색 시간이 초과되었습니다.', 'deadline', false);
    return remaining;
  }

  checkCall(): number {
    const remaining = this.remainingTime();
    if (this.remainingCalls <= 0) {
      throw new ProviderError(429, '이번 검색의 API 호출 한도에 도달했습니다.', 'call_budget', false);
    }
    return remaining;
  }

  useCall(): void {
    this.remainingCalls--;
  }
}

export class CallBudget {
  constructor(
    private readonly db: SupabaseDatabase,
    private readonly dailyLimit: number,
    private readonly minuteLimit: number,
    private readonly clientLimit: number,
  ) {}

  async take(operation: string, attempted: boolean, search?: SearchBudget): Promise<number> {
    try {
      const timeout = Math.min(4000, search?.checkCall() ?? 4000);
      const allowed = await this.db.rpc<boolean>('find_nearby_take_call', {
        operation_name: operation, daily_limit: this.dailyLimit,
        minute_limit: this.minuteLimit, reserve: search?.reserve ?? 0,
      }, timeout);
      if (!allowed) throw new ProviderError(429, '서비스 API 호출 한도에 도달했습니다.', 'call_budget', false);
      const remaining = search?.remainingTime() ?? 4000;
      search?.useCall();
      return Math.min(4000, remaining);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new ProviderError(error.status, error.message, error.reason, attempted);
      }
      // A slow database may have already reserved this call. Do not retry it or call Kakao.
      try {
        search?.remainingTime();
      } catch (deadline) {
        if (!(deadline instanceof ProviderError)) throw deadline;
        throw new ProviderError(deadline.status, deadline.message, deadline.reason, attempted);
      }
      throw new ProviderError(503, 'API 사용량을 확인할 수 없습니다.', 'provider_error', attempted);
    }
  }

  async allowClient(clientHash: string): Promise<boolean> {
    return await this.db.rpc<boolean>('find_nearby_take_request', {
      client_hash: clientHash, minute_limit: this.clientLimit,
    });
  }
}
