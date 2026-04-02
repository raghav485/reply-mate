import { GenericLocalChatApiLLMProviderAdapter } from "./GenericLocalChatApiLLMProviderAdapter.js";

// Cloud generation reuses the OpenAI-compatible chat adapter shape so hosted
// beta/public deployments can point at a managed HTTPS model endpoint.
export class CloudLLMProviderAdapter extends GenericLocalChatApiLLMProviderAdapter {}
