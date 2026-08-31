import { describe, expect, it } from "vitest";

import { createWorkspaceForOwner, getWorkspaceForUser, newWorkspaceId } from "@/db/workspaces";
import { makeTestAuth, signUp, headers } from "./helpers/testAuth";

describe("auth + workspace flow", () => {
  it("signup creates a user; workspace creation is a separate, idempotent step", async () => {
    const { auth, db, raw } = makeTestAuth();

    const { status, cookie } = await signUp(auth, "owner@x.example", "correct-horse-battery", "Owner");
    expect(status).toBe(200);

    const session = await auth.api.getSession({ headers: headers(cookie) });
    const userId = session!.user.id;

    // No workspace yet -> the app would send this user to /onboarding.
    expect(await getWorkspaceForUser(db, userId)).toBeNull();

    const ws1 = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: "Acme Agency",
      ownerUserId: userId,
    });
    expect(ws1.name).toBe("Acme Agency");
    expect((await getWorkspaceForUser(db, userId))?.id).toBe(ws1.id);

    // Retrying onboarding is safe: same workspace back, no duplicate.
    const ws2 = await createWorkspaceForOwner(db, {
      id: newWorkspaceId(),
      name: "Different Name",
      ownerUserId: userId,
    });
    expect(ws2.id).toBe(ws1.id);
    const count = raw
      .prepare("SELECT count(*) AS c FROM workspaces")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("wrong password is rejected and creates no session", async () => {
    const { auth } = makeTestAuth();
    await signUp(auth, "b@x.example", "correct-horse-battery");
    await expect(
      auth.api.signInEmail({ body: { email: "b@x.example", password: "wrong" } }),
    ).rejects.toBeDefined();
  });

  it("sign-out invalidates the session", async () => {
    const { auth } = makeTestAuth();
    const { cookie } = await signUp(auth, "c@x.example", "correct-horse-battery");
    expect((await auth.api.getSession({ headers: headers(cookie) }))?.user?.email).toBe("c@x.example");

    await auth.api.signOut({ headers: headers(cookie) });
    expect(await auth.api.getSession({ headers: headers(cookie) })).toBeNull();
  });
});
