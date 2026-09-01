import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Worker execution context bridge", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shares waitUntil state across duplicated Worker and server module instances", async () => {
    const workerBridge = await import("../app/lib/workerContext.server");

    vi.resetModules();
    const serverBridge = await import("../app/lib/workerContext.server");

    const tasks: Promise<unknown>[] = [];
    const context = {
      waitUntil(promise: Promise<unknown>) {
        tasks.push(promise);
      },
    };

    workerBridge.runWithWorkerExecutionContext(context, () => {
      serverBridge.waitUntilInCurrentWorker(Promise.resolve("email-sent"));
    });

    expect(tasks).toHaveLength(1);
    await expect(tasks[0]).resolves.toBe("email-sent");
  });
});
