import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  StorageProviderAdapter,
  TempObjectGetResponse,
  TempObjectPutRequest,
  TempObjectPutResponse,
} from "@replymate/contracts";

type S3StorageProviderAdapterOptions = {
  bucket: string;
};

function toBuffer(input: Blob | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(input)) {
    return Promise.resolve(input);
  }

  return input.arrayBuffer().then((buffer) => Buffer.from(buffer));
}

export class S3StorageProviderAdapter implements StorageProviderAdapter {
  constructor(
    private readonly client: S3Client,
    private readonly options: S3StorageProviderAdapterOptions
  ) {}

  async putTempObject(input: TempObjectPutRequest): Promise<TempObjectPutResponse> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        Body: await toBuffer(input.data),
        ContentType: input.mimeType,
        Metadata: {
          expiresat: expiresAt,
          mimetype: input.mimeType,
        },
      })
    );

    return {
      key: input.key,
      url: `s3://${this.options.bucket}/${input.key}`,
      expiresAt,
    };
  }

  async getTempObject(key: string): Promise<TempObjectGetResponse | null> {
    const head = await this.client
      .send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
        })
      )
      .catch((error: unknown) => {
        if (isMissingObjectError(error)) {
          return null;
        }
        throw error;
      });

    if (!head) {
      return null;
    }

    const expiresAt = head.Metadata?.expiresat || "";
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      await this.deleteTempObject(key);
      return null;
    }

    const object = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
        })
      )
      .catch((error: unknown) => {
        if (isMissingObjectError(error)) {
          return null;
        }
        throw error;
      });

    if (!object || !object.Body) {
      return null;
    }

    const bytes = await object.Body.transformToByteArray();
    return {
      key,
      data: Buffer.from(bytes),
      mimeType: object.ContentType || head.Metadata?.mimetype || "application/octet-stream",
      expiresAt,
    };
  }

  async deleteTempObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      })
    );
  }
}

function isMissingObjectError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "NotFound" ||
    error.name === "NoSuchKey" ||
    error.name === "NoSuchBucket" ||
    /not found|no such key/i.test(error.message)
  );
}
