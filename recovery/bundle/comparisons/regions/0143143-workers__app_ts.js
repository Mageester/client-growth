// workers/app.ts
var MONITOR_DIGEST_CRON = "0 13 * * *";
var handler = createRequestHandler(server_exports, "production");
var app_default = {
  fetch(request, env2, ctx) {
    return runWithWorkerExecutionContext(
      ctx,
      () => handler(request, { cloudflare: { env: env2, ctx } })
    );
  },
  /**
   * Recurring monitoring. One cron trigger for the whole product, not one per
   * client: this fires on a fixed schedule and each tick asks the database which
   * monitored clients are actually due, then processes a bounded batch of them.
   *
   * The scheduler's frequency and a client's cadence are independent. An hourly
   * tick can serve weekly clients precisely because being due, not being ticked,
   * is what selects a client.
   *
   * `waitUntil` keeps the invocation alive for the whole tick; the tick's own
   * wall-clock budget is what actually ends it, well inside the platform limit.
   *
   * This is the one path nobody is watching while it runs, so it must never fail
   * quietly. A tick that throws before its own error handling — a bad binding, a
   * D1 outage, a malformed env — used to reject straight out of this handler and
   * leave no log line at all: the hour simply produced nothing. Now the failure
   * is logged in the same shape as a success and then rethrown, so it also lands
   * in the platform's own cron error rate where an alert can reach a human.
   */
  async scheduled(controller, env2, ctx) {
    const rawEnv = env2;
    if (controller.cron === MONITOR_DIGEST_CRON) {
      await runScheduledTick(
        ctx,
        "monitor-digest",
        () => runMonitorDigestTick({ db: d1Db(env2.DB), env: rawEnv }),
        (r) => `considered=${r.considered} sent=${r.sent} skipped=${r.skipped} failed=${r.failed}`
      );
      return;
    }
    await runScheduledTick(
      ctx,
      "monitoring",
      () => runMonitoringTick({
        db: d1Db(env2.DB),
        env: rawEnv,
        limit: parseEnv(rawEnv).MONITORING_MAX_CLIENTS_PER_RUN
      }),
      (r) => `considered=${r.considered} scanned=${r.scanned} skipped=${r.skipped} failed=${r.failed} new=${r.newFindings} resolved=${r.resolvedFindings} evaluatorCalls=${r.evaluatorCalls} budgetExhausted=${r.budgetExhausted}`
    );
  }
};
async function runScheduledTick(ctx, label, run, summary) {
  const task = runWithWorkerExecutionContext(ctx, run);
  ctx.waitUntil(task.catch(() => void 0));
  let result;
  try {
    result = await task;
  } catch (error3) {
    const cause = error3 instanceof Error ? `${error3.name}: ${error3.message}` : String(error3);
    console.error(`[${label}] tick failed before reporting: ${cause}`);
    throw error3;
  }
  console.log(`[${label}] ${summary(result)}`);
}
__name(runScheduledTick, "runScheduledTick");
export {
  app_default as default
};
/*! Bundled license information:

react/cjs/react.production.js:
  (**
   * @license React
   * react.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react-jsx-runtime.production.js:
  (**
   * @license React
   * react-jsx-runtime.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.js:
  (**
   * @license React
   * react-dom.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom-server.edge.production.js:
  (**
   * @license React
   * react-dom-server.edge.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom-server-legacy.browser.production.js:
  (**
   * @license React
   * react-dom-server-legacy.browser.production.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-router/dist/development/chunk-BV7QT456.mjs:
react-router/dist/development/chunk-HT4INDD5.mjs:
react-router/dist/development/index.mjs:
  (**
   * react-router v7.18.3
   *
   * Copyright (c) Remix Software Inc.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE.md file in the root directory of this source tree.
   *
   * @license MIT
   *)

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=app.js.map