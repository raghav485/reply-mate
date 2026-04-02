import type {
  StorageProviderAdapter,
  TempObjectGetResponse,
  TempObjectPutRequest,
  TempObjectPutResponse,
} from "@replymate/contracts";

type StoredObject = {
  data: Buffer;
  mimeType: string;
  expiresAtMs: number;
};

function toBuffer(data: Blob | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) {
    return Promise.resolve(data);
  }

  return data.arrayBuffer().then((buf) => Buffer.from(buf));
}

export class InMemoryStorageProviderAdapter implements StorageProviderAdapter {
  private objects = new Map<string, StoredObject>();

  async putTempObject(input: TempObjectPutRequest): Promise<TempObjectPutResponse> {
    const payload = await toBuffer(input.data);
    const expiresAtMs = Date.now() + input.ttlSeconds * 1000;

    this.objects.set(input.key, {
      data: payload,
      mimeType: input.mimeType,
      expiresAtMs,
    });

    return {
      key: input.key,
      url: `memory://replymate/${encodeURIComponent(input.key)}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async getTempObject(key: string): Promise<TempObjectGetResponse | null> {
    const stored = this.objects.get(key);
    if (!stored) {
      return null;
    }

    if (stored.expiresAtMs <= Date.now()) {
      this.objects.delete(key);
      return null;
    }

    return {
      key,
      data: Buffer.from(stored.data),
      mimeType: stored.mimeType,
      expiresAt: new Date(stored.expiresAtMs).toISOString(),
    };
  }

  async deleteTempObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  sweep(nowMs = Date.now()): void {
    for (const [key, value] of this.objects.entries()) {
      if (value.expiresAtMs <= nowMs) {
        this.objects.delete(key);
      }
    }
  }
}
