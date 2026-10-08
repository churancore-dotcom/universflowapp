/** Own only URLs created here; never revoke native file/content URLs. */
export class DownloadObjectUrls {
  private readonly urls = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  release(url: string | null | undefined): void {
    if (!url || !this.urls.delete(url)) return;
    URL.revokeObjectURL(url);
  }

  clear(): void {
    for (const url of [...this.urls]) this.release(url);
  }
}