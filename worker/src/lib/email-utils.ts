/**
 * Inject per-recipient tracking into email HTML.
 *
 * Every contact gets their own sendId-scoped URLs so open/click/unsub
 * events can be attributed to the right contact record.
 */
export function injectTracking(html: string, sendId: string, trackerUrl: string): string {
  const pixel = `<img src="${trackerUrl}/t/open/${sendId}" width="1" height="1" style="display:none" alt="" />`;
  const unsubLink = `<div style="text-align:center;padding:16px;font-size:12px;color:#888">
    <a href="${trackerUrl}/t/unsub/${sendId}" style="color:#888">Unsubscribe</a>
  </div>`;

  const withTrackedLinks = html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_, url) => `href="${trackerUrl}/t/click/${sendId}?url=${encodeURIComponent(url)}"`
  );

  const injected = withTrackedLinks.replace(/<\/body>/i, `${pixel}${unsubLink}</body>`);
  return injected !== withTrackedLinks ? injected : withTrackedLinks + pixel + unsubLink;
}

/** Split an array into sequential chunks of at most `size` elements. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
