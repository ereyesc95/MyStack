import { clearArtistWordCloudCache } from "./artistWordCloudCache";

export const WORD_CLOUD_INVALIDATE_EVENT = "mystack:word-cloud-invalidate";

export function invalidateWordCloud(bandId: number): void {
  clearArtistWordCloudCache(bandId);
  window.dispatchEvent(
    new CustomEvent(WORD_CLOUD_INVALIDATE_EVENT, { detail: { bandId } })
  );
}
