import { getClient } from "@/db/repositories";
import type { TenantScope } from "@/db/tenant";
import type { EvidenceLink, EvidencePage } from "@/core/schema";
import type { VisualScreenshot } from "@/core/visualSchema";

export interface PersistedVisualScreenshot extends VisualScreenshot {
  dataUrl: string;
  text: string;
  page: EvidencePage;
  links: EvidenceLink[];
}

export async function saveVisualScreenshots(
  t: TenantScope,
  clientId: string,
  screenshots: readonly PersistedVisualScreenshot[],
): Promise<void> {
  if (!(await getClient(t, clientId))) throw new Error("Client not found");
  for (const shot of screenshots.slice(0, 4)) {
    if (shot.dataUrl.length > 350_050 || !shot.dataUrl.startsWith("data:image/jpeg;base64,/9j/")) {
      throw new Error("Invalid screenshot");
    }
    const { dataUrl, text: _text, page: _page, links: _links, ...metadata } = shot;
    await t.db
      .prepare("INSERT INTO visual_screenshots (id,workspace_id,client_id,metadata,data_url,captured_at) VALUES (?,?,?,?,?,?)")
      .bind(shot.id, t.workspaceId, clientId, JSON.stringify(metadata), dataUrl, shot.capturedAt)
      .run();
  }
}
