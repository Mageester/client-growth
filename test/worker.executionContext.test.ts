import { describe, expect, it, vi } from "vitest";

/**
 * Guards the production fix for the password-reset email.
 *
 * The Worker entry and the generated server bundle each carry their own copy of
 * workerContext.server.ts. When each copy built its own AsyncLocalStorage, the
 * entry stored the request's ExecutionContext in one instance and Better Auth's
 * background email task read from the other, found nothing, and lost
 * ctx.waitUntil — so the reset email sometimes never went out.
 *
 * The bridge is therefore keyed on the isolate global. These tests fail loudly
 * if that keying is ever refactored away.
 */
describe("Worker execution context bridge", () => {
  it("resolves to the same storage across independent module instances", async () => {
    vi.resetModules();
    const entry = await import("../app/lib/workerContext.server");
    vi.resetModules();
    const serverBundle = await import("../app/lib/workerContext.server");

    // Distinct module objects — this is the situation the fix exists for.
    expect(entry).not.toBe(serverBundle);

    const tasks: Promise<unknown>[] = [];
    entry.runWithWorkerExecutionContext(
      { waitUntil: (p) => void tasks.push(p) },
      () => serverBundle.waitUntilInCurrentWorker(Promise.resolve("sent")),
    );

    expect(tasks).toHaveLength(1);
    await expect(tasks[0]).resolves.toBe("sent");
  });

  it("registers the bridge on the isolate global under a stable key", async () => {
    vi.resetModules();
    const key = Symbol.for("client-growth.worker-execution-context");
    delete (globalThis as unknown as Record<PropertyKey, unknown>)[key];

    await import("../app/lib/workerContext.server");
    expect((globalThis as unknown as Record<PropertyKey, unknown>)[key]).toBeDefined();

    // A second import must adopt the existing storage, not replace it.
    const first = (globalThis as unknown as Record<PropertyKey, unknown>)[key];
    vi.resetModules();
    await import("../app/lib/workerContext.server");
    expect((globalThis as unknown as Record<PropertyKey, unknown>)[key]).toBe(first);
  });

  it("nested scopes restore the outer context when they unwind", async () => {
    vi.resetModules();
    const bridge = await import("../app/lib/workerContext.server");

    const outer: Promise<unknown>[] = [];
    const inner: Promise<unknown>[] = [];

    bridge.runWithWorkerExecutionContext({ waitUntil: (p) => void outer.push(p) }, () => {
      bridge.runWithWorkerExecutionContext({ waitUntil: (p) => void inner.push(p) }, () => {
        bridge.waitUntilInCurrentWorker(Promise.resolve("inner"));
      });
      bridge.waitUntilInCurrentWorker(Promise.resolve("outer"));
    });

    expect(inner).toHaveLength(1);
    expect(outer).toHaveLength(1);
    await expect(outer[0]).resolves.toBe("outer");
  });

  it("swallows a rejection outside any Worker request rather than crashing the isolate", async () => {
    vi.resetModules();
    const bridge = await import("../app/lib/workerContext.server");
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      bridge.waitUntilInCurrentWorker(Promise.reject(new Error("no owner")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("propagates the context through an await, which is how the email task runs", async () => {
    vi.resetModules();
    const bridge = await import("../app/lib/workerContext.server");
    const tasks: Promise<unknown>[] = [];

    await bridge.runWithWorkerExecutionContext(
      { waitUntil: (p) => void tasks.push(p) },
      async () => {
        await Promise.resolve();
        bridge.waitUntilInCurrentWorker(Promise.resolve("after-await"));
      },
    );

    expect(tasks).toHaveLength(1);
    await expect(tasks[0]).resolves.toBe("after-await");
  });
});
