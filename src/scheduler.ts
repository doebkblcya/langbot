import type { Scheduler } from './contracts.js';
import { Failure } from './errors.js';

interface Job {
  key: string;
  created: number;
  run: (signal: AbortSignal) => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
export class SessionQueue implements Scheduler {
  private pending: Job[] = [];
  private running = new Map<string, AbortController>();
  private jobs = new Set<Promise<void>>();
  private closed = false;
  constructor(private concurrency: number, private capacity: number, private maxAgeMs: number) {}
  enqueue(key: string, run: Job['run']): Promise<void> {
    if (this.closed) return Promise.reject(new Failure('cancelled'));
    if (this.pending.length >= this.capacity) return Promise.reject(new Failure('queue_full'));
    return new Promise((resolve, reject) => {
      this.pending.push({ key, created: Date.now(), run, resolve, reject });
      this.pump();
    });
  }
  private pump(): void {
    if (this.closed) return;
    while (this.running.size < this.concurrency) {
      const index = this.pending.findIndex(job => !this.running.has(job.key));
      if (index === -1) return;
      const job = this.pending.splice(index, 1)[0]!;
      if (Date.now() - job.created > this.maxAgeMs) { job.reject(new Failure('queue_expired')); continue; }
      const controller = new AbortController();
      this.running.set(job.key, controller);
      const task = Promise.resolve().then(() => job.run(controller.signal)).then(job.resolve, job.reject).finally(() => {
        this.running.delete(job.key);
        this.jobs.delete(task);
        this.pump();
      });
      this.jobs.add(task);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.pending.splice(0)) job.reject(new Failure('cancelled'));
    for (const controller of this.running.values()) controller.abort();
    await Promise.allSettled([...this.jobs]);
  }
}
