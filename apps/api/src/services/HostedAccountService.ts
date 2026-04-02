import type {
  AccountPreferences,
  GenerateDraftRequest,
  GenerateDraftResponse,
  GenerationRecordSummary,
} from "@replymate/contracts";
import type { HostedStateRepository } from "../persistence/HostedStateRepository.js";

export class HostedAccountService {
  constructor(private readonly repository: HostedStateRepository) {}

  getPreferences(accountId: string): Promise<AccountPreferences> {
    return this.repository.getAccountPreferences(accountId);
  }

  savePreferences(
    accountId: string,
    preferences: AccountPreferences
  ): Promise<AccountPreferences> {
    return this.repository.saveAccountPreferences(accountId, preferences);
  }

  listGenerationRecords(
    accountId: string,
    limit = 25
  ): Promise<GenerationRecordSummary[]> {
    return this.repository.listGenerationRecords(accountId, limit);
  }

  async recordGeneration(input: {
    accountId: string;
    requestId: string;
    request: GenerateDraftRequest;
    response: GenerateDraftResponse;
  }): Promise<void> {
    const primaryDraft = input.response.drafts[0]?.text || "";
    const alternateDraft = input.response.drafts[1]?.text || primaryDraft;

    await this.repository.appendGenerationRecord({
      generationId: `gen_${input.requestId}`,
      accountId: input.accountId,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
      siteId: input.request.siteId,
      actionMode: input.request.actionMode,
      tonePreset: input.request.tonePreset,
      providerPath: input.response.inputSummary.providerPath,
      warningCount: input.response.warnings.length,
      usedVoiceInput: input.response.inputSummary.usedVoiceInput,
      contextScopeUsed: input.response.inputSummary.contextScopeUsed,
      evidenceIdsUsed: [...input.response.inputSummary.evidenceIdsUsed],
      primaryDraft,
      alternateDraft,
    });
  }
}
