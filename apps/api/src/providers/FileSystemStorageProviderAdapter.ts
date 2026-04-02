import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  StorageProviderAdapter,
  TempObjectGetResponse,
  TempObjectPutRequest,
  TempObjectPutResponse,
} from "@replymate/contracts";

type StoredObjectMetadata = {
  mimeType: string;
  expiresAt: string;
};

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9/_-]+/g, "_");
}

export class FileSystemStorageProviderAdapter implements StorageProviderAdapter {
  constructor(private readonly rootDir: string) {}

  async putTempObject(input: TempObjectPutRequest): Promise<TempObjectPutResponse> {
    const key = sanitizeKey(input.key);
    const dataPath = this.resolveDataPath(key);
    const metaPath = this.resolveMetaPath(key);
    const expiresAtMs = Date.now() + input.ttlSeconds * 1000;
    const data = Buffer.isBuffer(input.data)
      ? input.data
      : Buffer.from(await input.data.arrayBuffer());

    await mkdir(path.dirname(dataPath), { recursive: true });
    await writeFile(dataPath, data);
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          mimeType: input.mimeType,
          expiresAt: new Date(expiresAtMs).toISOString(),
        } satisfies StoredObjectMetadata,
        null,
        2
      ),
      "utf8"
    );

    return {
      key,
      url: `file://${dataPath}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async getTempObject(key: string): Promise<TempObjectGetResponse | null> {
    const normalizedKey = sanitizeKey(key);
    const dataPath = this.resolveDataPath(normalizedKey);
    const metaPath = this.resolveMetaPath(normalizedKey);

    try {
      const [data, metaRaw] = await Promise.all([
        readFile(dataPath),
        readFile(metaPath, "utf8"),
      ]);
      const meta = JSON.parse(metaRaw) as StoredObjectMetadata;
      if (Date.parse(meta.expiresAt) <= Date.now()) {
        await this.deleteTempObject(normalizedKey);
        return null;
      }

      return {
        key: normalizedKey,
        data,
        mimeType: meta.mimeType,
        expiresAt: meta.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async deleteTempObject(key: string): Promise<void> {
    const normalizedKey = sanitizeKey(key);
    await Promise.allSettled([
      rm(this.resolveDataPath(normalizedKey), { force: true }),
      rm(this.resolveMetaPath(normalizedKey), { force: true }),
    ]);
  }

  private resolveDataPath(key: string): string {
    return path.join(this.rootDir, `${key}.bin`);
  }

  private resolveMetaPath(key: string): string {
    return path.join(this.rootDir, `${key}.json`);
  }
}
