// app/lib/monitorDigest.server.ts
function describeError2(err) {
  const text = err instanceof Response ? `${err.status} ${err.statusText}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 200);
}
__name(describeError2, "describeError");
function resolveDigestSender(env2) {
  const transport = resolveMailTransport(env2);
  if (transport.kind === "resend") return createResendMonitorDigestSender(transport.config);
  if (transport.kind === "console") {
    return async (message2) => {
      console.log(
        `[monitor-digest:console] to=${message2.to} subject=${message2.subject}
${message2.text}`
      );
    };
  }
  return null;
}
__name(resolveDigestSender, "resolveDigestSender");
async function processWorkspaceDigest(db, target, ctx) {
  const t = { db, workspaceId: target.workspaceId };
  const since = target.lastSentAt ?? new Date(ctx.now.getTime() - MONITOR_DIGEST_PERIOD_MS).toISOString();
  const until = ctx.now.toISOString();
  const record2 = /* @__PURE__ */ __name((outcome, extra) => recordMonitorDigestRun(t, {
    periodStart: since,
    periodEnd: until,
    sentAt: until,
    recipient: extra.recipient ?? null,
    outcome,
    newCount: extra.newFindings ?? 0,
    resolvedCount: extra.resolvedFindings ?? 0,
    clientCount: extra.clientCount ?? 0,
    error: extra.error ?? null
  }), "record");
  const finish = /* @__PURE__ */ __name((sent) => finishWorkspaceDigest(db, target.workspaceId, { now: ctx.now, sent }), "finish");
  const result = /* @__PURE__ */ __name((outcome, newFindings = 0, resolvedFindings = 0) => ({ workspaceId: target.workspaceId, outcome, newFindings, resolvedFindings }), "result");
  if (!decideMonitorEntitlement({ policy: ctx.policy, ownerEmail: target.ownerEmail }).entitled) {
    await record2("skipped_not_entitled", {});
    await finish(false);
    return result("skipped_not_entitled");
  }
  const facts = await collectDigestFacts(t, { since, until, now: ctx.now });
  const model = buildMonitorDigest(facts);
  const recipient = target.recipient && target.recipient.trim().length > 0 ? target.recipient.trim() : target.ownerEmail;
  const wantSend = ctx.force || shouldSendDigest(model, { cadence: "weekly", onlyOnChange: target.onlyOnChange });
  if (!wantSend) {
    await record2("skipped_no_change", {
      newFindings: model.totals.newFindings,
      resolvedFindings: model.totals.resolvedFindings,
      clientCount: model.totals.clientsWithChange
    });
    await finish(false);
    return result("skipped_no_change", model.totals.newFindings, model.totals.resolvedFindings);
  }
  if (!recipient) {
    await record2("failed", { error: "no recipient address for this workspace" });
    await finish(false);
    return result("failed");
  }
  try {
    await ctx.send({
      to: recipient,
      workspaceId: target.workspaceId,
      periodStart: since,
      subject: digestSubject(model),
      text: renderMonitorDigestText(model, ctx.baseUrl),
      html: renderMonitorDigestHtml(model, ctx.baseUrl)
    });
  } catch (err) {
    await record2("failed", {
      recipient,
      error: describeError2(err),
      newFindings: model.totals.newFindings,
      resolvedFindings: model.totals.resolvedFindings,
      clientCount: model.totals.clientsWithChange
    });
    await finish(false);
    return result("failed", model.totals.newFindings, model.totals.resolvedFindings);
  }
  await record2("sent", {
    recipient,
    newFindings: model.totals.newFindings,
    resolvedFindings: model.totals.resolvedFindings,
    clientCount: model.totals.clientsWithChange
  });
  await finish(true);
  return result("sent", model.totals.newFindings, model.totals.resolvedFindings);
}
__name(processWorkspaceDigest, "processWorkspaceDigest");
async function runMonitorDigestTick(options) {
  const now2 = options.now ?? /* @__PURE__ */ new Date();
  const policy3 = parseMonitorEntitlementPolicy(options.env);
  const limit = options.limit ?? parseEnv(options.env).MONITOR_DIGEST_MAX_PER_RUN;
  const result = {
    startedAt: now2.toISOString(),
    finishedAt: now2.toISOString(),
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    workspaces: []
  };
  if (policy3.mode === "off") {
    result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    return result;
  }
  const send = options.send ?? resolveDigestSender(options.env);
  if (!send) {
    console.warn("[monitor-digest] no email transport configured; skipping the digest tick");
    result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    return result;
  }
  const baseUrl = options.baseUrl ?? getTrustedAuthBaseURL(options.env);
  const due = await listWorkspacesDueForDigest(options.db, { now: now2, limit });
  result.considered = due.length;
  for (const target of due) {
    const claimed = await claimWorkspaceDigest(options.db, target.workspaceId, now2);
    if (!claimed) {
      result.skipped++;
      result.workspaces.push({
        workspaceId: target.workspaceId,
        outcome: "skipped_claim",
        newFindings: 0,
        resolvedFindings: 0
      });
      continue;
    }
    try {
      const outcome = await processWorkspaceDigest(options.db, target, { now: now2, policy: policy3, baseUrl, send });
      if (outcome.outcome === "sent") result.sent++;
      else if (outcome.outcome === "failed") result.failed++;
      else result.skipped++;
      result.workspaces.push(outcome);
    } catch (err) {
      console.error(`[monitor-digest] tick failed for ${target.workspaceId}: ${describeError2(err)}`);
      try {
        await finishWorkspaceDigest(options.db, target.workspaceId, { now: now2, sent: false });
      } catch (finishErr) {
        console.error(
          `[monitor-digest] could not release ${target.workspaceId}: ${describeError2(finishErr)}`
        );
      }
      result.failed++;
      result.workspaces.push({
        workspaceId: target.workspaceId,
        outcome: "failed",
        newFindings: 0,
        resolvedFindings: 0
      });
    }
  }
  result.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  return result;
}
__name(runMonitorDigestTick, "runMonitorDigestTick");
