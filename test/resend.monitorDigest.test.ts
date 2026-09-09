import { describe, expect, it, vi } from "vitest";

import {
  RESEND_EMAILS_URL,
  createResendMonitorDigestSender,
  type MonitorDigestEmail,
} from "../app/lib/resend.server";

const config = { apiKey: "re_test_key", from: "Axiom Orbit <noreply@getaxiom.ca>" };

const message: MonitorDigestEmail = {
  to: "owner@agency.example",
  workspaceId: "ws_123",
  periodStart: "2026-09-01T00:00:00.000Z",
  subject: "Axiom Orbit — 2 new opportunities across your clients",
  text: "plain text digest",
  html: "<div>digest</div>",
};

describe("createResendMonitorDigestSender", () => {
  it("posts the digest with a per-week idempotency key and both bodies", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    await createResendMonitorDigestSender(config, fetcher as unknown as typeof fetch)(message);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const call = fetcher.mock.calls[0]!;
    const init = call[1]!;
    expect(call[0]).toBe(RESEND_EMAILS_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("monitor-digest/ws_123/2026-09-01T00:00:00.000Z");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: config.from,
      to: ["owner@agency.example"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it("fails generically when the provider rejects", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 422 }));
    await expect(
      createResendMonitorDigestSender(config, fetcher as unknown as typeof fetch)(message),
    ).rejects.toThrow("Monitor digest email delivery failed");
  });

  it("fails generically when the request throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("network down");
    });
    await expect(
      createResendMonitorDigestSender(config, fetcher as unknown as typeof fetch)(message),
    ).rejects.toThrow("Monitor digest email delivery failed");
  });
});
