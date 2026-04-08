# ReplyMate Install and Help Guide

## What ReplyMate needs

ReplyMate works in two public-user modes:

- `Local Models`: use Ollama or another loopback OpenAI-compatible endpoint you control
- `Use Your Own API`: use your own OpenAI, Anthropic, Gemini, OpenRouter, or custom
  OpenAI-compatible provider

ReplyMate stores saved provider keys only as encrypted vault data at rest.

## First-run checklist

1. Install ReplyMate from the Chrome Web Store.
2. Open ReplyMate Settings.
3. Choose `Local Models` or `Use Your Own API`.
4. Configure the current provider or local runtime.
5. Set up the vault if you want ReplyMate to remember a provider key.
6. Click `Validate Connection`.
7. Return to the Side Panel and generate a draft.

## Vault behavior

- Passkey unlock is the preferred setup.
- Passphrase fallback is available if passkey unlock is unavailable or declined.
- Chrome can unload the ReplyMate background service worker.
- When that happens, ReplyMate relocks and may ask you to unlock again before it can use stored
  provider keys.

## Local model setup

For the default local setup:

- install and start Ollama
- use `qwen3:8b` for writing
- use `minicpm-v` if you want image OCR

If `Validate Connection` succeeds but `Generate Replies` shows `Forbidden`, Ollama is usually
blocking the Chrome extension origin. Use the extension ID shown in ReplyMate Settings and restart
Ollama with:

```bash
OLLAMA_ORIGINS=chrome-extension://<your-extension-id>
```

## Custom OpenAI-compatible providers

When you use `Custom OpenAI-compatible`, ReplyMate requests one-time Chrome host permission for the
exact origin you configure. Chrome prompts only when ReplyMate needs that origin.

## Common recovery steps

### Vault locked

- unlock from the Side Panel if prompted
- or open Settings and unlock there

### Custom host permission missing

- open Settings
- keep the same custom base URL
- retry `Validate Connection` and approve the Chrome permission prompt

### Unsupported page or no composer found

- switch to a normal website tab
- focus the actual text box you want to draft into
- reopen the Side Panel if needed

### Browser restart or extension reload

- expect ReplyMate to relock
- unlock again before using saved BYOK credentials
