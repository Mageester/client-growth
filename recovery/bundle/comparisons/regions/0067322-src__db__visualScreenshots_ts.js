// src/db/visualScreenshots.ts
async function saveVisualScreenshots(t, clientId2, screenshots) {
  if (!await getClient(t, clientId2)) throw new Error("Client not found");
  for (const shot of screenshots.slice(0, 4)) {
    if (shot.dataUrl.length > 350050 || !shot.dataUrl.startsWith("data:image/jpeg;base64,/9j/"))
      throw new Error("Invalid screenshot");
    const { dataUrl, text, page, links: links2, ...metadata } = shot;
    await t.db.prepare(
      "INSERT INTO visual_screenshots (id,workspace_id,client_id,metadata,data_url,captured_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      shot.id,
      t.workspaceId,
      clientId2,
      JSON.stringify(metadata),
      dataUrl,
      shot.capturedAt
    ).run();
  }
}
__name(saveVisualScreenshots, "saveVisualScreenshots");
