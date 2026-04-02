import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderRuntime } from "../index.js";
import { FileSystemStorageProviderAdapter } from "../FileSystemStorageProviderAdapter.js";
import { InMemoryStorageProviderAdapter } from "../InMemoryStorageProviderAdapter.js";
import { S3StorageProviderAdapter } from "../S3StorageProviderAdapter.js";

describe("createProviderRuntime storage selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to in-memory storage in local mode", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "local");
    vi.stubEnv("REPLYMATE_STORAGE_DRIVER", "");

    const runtime = createProviderRuntime();

    expect(runtime.storage).toBeInstanceOf(InMemoryStorageProviderAdapter);
  });

  it("allows hosted beta to use filesystem storage explicitly", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    vi.stubEnv("REPLYMATE_STORAGE_DRIVER", "filesystem");
    vi.stubEnv("REPLYMATE_STORAGE_FILESYSTEM_ROOT", "/tmp/replymate-storage-test");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_BASE_URL", "https://example-llm.test");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_MODEL", "test-model");

    const runtime = createProviderRuntime();

    expect(runtime.storage).toBeInstanceOf(FileSystemStorageProviderAdapter);
  });

  it("defaults hosted storage to S3 when configured", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    vi.stubEnv("REPLYMATE_STORAGE_DRIVER", "");
    vi.stubEnv("REPLYMATE_STORAGE_BUCKET", "replymate-bucket");
    vi.stubEnv("REPLYMATE_STORAGE_REGION", "us-west-1");
    vi.stubEnv("REPLYMATE_STORAGE_ENDPOINT", "https://s3.replymate.test");
    vi.stubEnv("REPLYMATE_STORAGE_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("REPLYMATE_STORAGE_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_BASE_URL", "https://example-llm.test");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_MODEL", "test-model");

    const runtime = createProviderRuntime();

    expect(runtime.storage).toBeInstanceOf(S3StorageProviderAdapter);
  });

  it("rejects hosted mode when S3 config is incomplete", () => {
    vi.stubEnv("REPLYMATE_DEPLOYMENT_MODE", "hosted_beta");
    vi.stubEnv("REPLYMATE_STORAGE_DRIVER", "");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_BASE_URL", "https://example-llm.test");
    vi.stubEnv("REPLYMATE_CLOUD_DRAFT_MODEL", "test-model");

    expect(() => createProviderRuntime()).toThrow(
      "REPLYMATE_STORAGE_DRIVER=s3 requires bucket, region, access key, and secret key configuration."
    );
  });
});
