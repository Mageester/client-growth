import { AsyncLocalStorage } from "node:async_hooks";

export interface WorkerExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

// The Worker entry and the generated server bundle can each contain a copy of
// this module. Store the bridge on the isolate global so both copies observe
// the same request-scoped execution context.
const executionContextKey = Symbol.for("client-growth.worker-execution-context");
const globalRegistry = globalThis as unknown as Record<PropertyKey, unknown>;
const executionContext =
  (globalRegistry[executionContextKey] as
    | AsyncLocalStorage<WorkerExecutionContextLike>
    | undefined) ??
  (() => {
    const context = new AsyncLocalStorage<WorkerExecutionContextLike>();
    globalRegistry[executionContextKey] = context;
    return context;
  })();

export function runWithWorkerExecutionContext<T>(
  context: WorkerExecutionContextLike,
  callback: () => T,
): T {
  return executionContext.run(context, callback);
}

export function waitUntilInCurrentWorker(promise: Promise<unknown>): void {
  const context = executionContext.getStore();
  if (context) {
    context.waitUntil(promise);
    return;
  }

  // Direct API tests and non-Worker tooling have no waitUntil owner. Keep the
  // rejected task handled rather than creating an unhandled rejection.
  void promise.catch(() => undefined);
}
