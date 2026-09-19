// app/lib/workerContext.server.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var executionContextKey = /* @__PURE__ */ Symbol.for("client-growth.worker-execution-context");
var globalRegistry2 = globalThis;
var executionContext = globalRegistry2[executionContextKey] ?? (() => {
  const context = new AsyncLocalStorage2();
  globalRegistry2[executionContextKey] = context;
  return context;
})();
function runWithWorkerExecutionContext(context, callback) {
  return executionContext.run(context, callback);
}
__name(runWithWorkerExecutionContext, "runWithWorkerExecutionContext");
