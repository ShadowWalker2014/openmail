/**
 * Batching queue for high-volume event tracking.
 * Buffers items and flushes them either when the batch is full
 * or when the flush interval fires.
 */
export interface QueueItem<T> {
  data: T;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export type FlushFn<T> = (items: T[]) => Promise<unknown[]>;

export interface QueueConfig<T> {
  flushAt?: number;
  flushInterval?: number;
  flush: FlushFn<T>;
  onError?: (err: Error, items: T[]) => void;
}

export class BatchQueue<T> {
  private readonly flushAt: number;
  private readonly flushInterval: number;
  private readonly flushFn: FlushFn<T>;
  private readonly onError?: (err: Error, items: T[]) => void;
  private queue: QueueItem<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Track the in-flight flush so concurrent flush() calls wait for it
  private _inflight: Promise<void> | null = null;

  constructor(config: QueueConfig<T>) {
    this.flushAt = config.flushAt ?? 20;
    this.flushInterval = config.flushInterval ?? 10_000;
    this.flushFn = config.flush;
    this.onError = config.onError;
  }

  push(item: T): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data: item, resolve, reject });

      if (this.queue.length >= this.flushAt) {
        this._scheduleFlush(0);
      } else if (!this.timer) {
        this._scheduleFlush(this.flushInterval);
      }
    });
  }

  private _scheduleFlush(delay: number) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      // CRITICAL FIX: null the timer BEFORE _flush() so subsequent pushes
      // can schedule a new interval timer after this batch is drained.
      this.timer = null;
      this._flush();
    }, delay);
  }

  /**
   * Flush all buffered items.
   * If a flush is already in-flight, waits for it to complete before
   * initiating a second pass for any items that accumulated meanwhile.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Wait for any in-flight flush to settle first
    if (this._inflight) await this._inflight;
    // Then flush whatever remains
    if (this.queue.length > 0) await this._flush();
  }

  private _flush(): Promise<void> {
    if (this.queue.length === 0) return Promise.resolve();
    // Return existing in-flight promise to avoid concurrent sends
    if (this._inflight) return this._inflight;

    const batch = this.queue.splice(0, this.flushAt);
    const items = batch.map((q) => q.data);

    this._inflight = this.flushFn(items)
      .then((results) => {
        batch.forEach((q, i) => q.resolve(results[i] ?? null));
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        batch.forEach((q) => q.reject(error));
        this.onError?.(error, items);
      })
      .finally(() => {
        this._inflight = null;
        // Flush again if items accumulated while we were flushing
        if (this.queue.length > 0) {
          this._scheduleFlush(0);
        }
      });

    return this._inflight;
  }

  get pending(): number {
    return this.queue.length;
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Reject pending items
    this.queue.forEach((q) =>
      q.reject(new Error("Queue destroyed — flush before shutdown"))
    );
    this.queue = [];
  }
}
