import { describe, it, expect, vi } from "vitest";
import { BatchQueue } from "../core/queue.js";

describe("BatchQueue", () => {
  it("flushes at the flushAt threshold", async () => {
    const flushed: number[][] = [];
    const queue = new BatchQueue<number>({
      flushAt: 3,
      flushInterval: 999_999,
      flush: async (items) => {
        flushed.push(items);
        return items.map(() => "ok");
      },
    });

    queue.push(1);
    queue.push(2);
    await queue.push(3); // triggers flush
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual([1, 2, 3]);
  });

  it("flushes remaining items on flush()", async () => {
    const flushed: number[][] = [];
    const queue = new BatchQueue<number>({
      flushAt: 10,
      flushInterval: 999_999,
      flush: async (items) => {
        flushed.push(items);
        return items.map(() => "ok");
      },
    });

    queue.push(1);
    queue.push(2);
    await queue.flush();
    expect(flushed[0]).toEqual([1, 2]);
  });

  it("calls onError when flush fails", async () => {
    const errors: Error[] = [];
    const queue = new BatchQueue<string>({
      flushAt: 1,
      flushInterval: 999_999,
      flush: async () => { throw new Error("Flush failed"); },
      onError: (err) => errors.push(err),
    });

    await expect(queue.push("test")).rejects.toThrow("Flush failed");
    expect(errors[0].message).toBe("Flush failed");
  });

  it("tracks pending count", async () => {
    const queue = new BatchQueue<number>({
      flushAt: 10,
      flushInterval: 999_999,
      flush: async (items) => items.map(() => "ok"),
    });

    queue.push(1);
    queue.push(2);
    expect(queue.pending).toBe(2);
    await queue.flush();
    expect(queue.pending).toBe(0);
  });

  it("destroy rejects pending items", () => {
    const queue = new BatchQueue<string>({
      flushAt: 10,
      flushInterval: 999_999,
      flush: async (items) => items.map(() => "ok"),
    });

    const p = queue.push("test");
    queue.destroy();
    return expect(p).rejects.toThrow("Queue destroyed");
  });
});
