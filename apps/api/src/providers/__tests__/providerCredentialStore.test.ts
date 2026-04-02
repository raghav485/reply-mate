import { afterEach, describe, expect, it } from "vitest";
import {
  buildProviderCredentialStatusResponse,
  getProviderCredentialStore,
  hydrateProviderConfigSecrets,
} from "../providerCredentialStore.js";

describe("providerCredentialStore", () => {
  afterEach(async () => {
    const store = getProviderCredentialStore();
    await store.deleteCredential({ target: "cloud", kind: "openai" });
    await store.deleteCredential({
      target: "local",
      kind: "openai_compatible_local",
    });
  });

  it("stores and reports provider credentials through the local store", async () => {
    const store = getProviderCredentialStore();

    await store.writeCredential({
      target: "cloud",
      kind: "openai",
      apiKey: "sk-test",
    });

    const status = await buildProviderCredentialStatusResponse(store);

    expect(status.storage.supported).toBe(true);
    expect(status.credentials).toContainEqual({
      target: "cloud",
      kind: "openai",
      hasStoredApiKey: true,
    });
  });

  it("hydrates request-scoped provider config from the secure store", async () => {
    const store = getProviderCredentialStore();
    await store.writeCredential({
      target: "local",
      kind: "openai_compatible_local",
      apiKey: "local-secret",
    });

    const config = await hydrateProviderConfigSecrets(
      {
        mode: "local_models" as const,
        local: {
          kind: "openai_compatible_local" as const,
          baseUrl: "http://127.0.0.1:1234/v1",
          modelName: "qwen3:8b",
          apiKey: "",
          hasStoredApiKey: true,
        },
        cloud: {
          kind: "openai" as const,
          baseUrl: "",
          modelName: "",
          apiKey: "",
          hasStoredApiKey: false,
        },
      },
      store
    );

    expect(config?.local.apiKey).toBe("local-secret");
  });
});
