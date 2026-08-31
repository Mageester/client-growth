import { AsyncLocalStorage } from "node:async_hooks";

export interface WorkerExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const executionContext = new AsyncLocalStorage<WorkerExecutionContextLike>();

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
