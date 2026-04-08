# ReplyMate

ReplyMate is a free, local-first Chrome extension for drafting customer-facing replies inside Slack, Gmail, and similar web apps.

The product has two user-facing modes:

- `Local Models`: run your own local model through Ollama or another loopback OpenAI-compatible endpoint
- `Use Your Own API`: connect your own OpenAI, Anthropic, Gemini, OpenRouter, or custom OpenAI-compatible account

ReplyMate does not bill or proxy your provider usage in those modes.

## Provider-Key Security Model

The current store path is extension-owned and vault-backed:

- saved settings store provider metadata only
- provider keys are stored only as encrypted vault data at rest in `chrome.storage.local`
- raw provider keys are not stored in `chrome.storage.local`, `chrome.storage.sync`, or `chrome.storage.session`
- decrypted keys live only in the background service worker while Chrome keeps it alive
- Chrome can unload the background service worker, which relocks ReplyMate until you unlock again
- passkey unlock is the primary path; passphrase fallback is available if needed

## Store Launch Docs

Public launch materials now live in [`docs/store/README.md`](./docs/store/README.md):

- [`docs/store/privacy-policy.md`](./docs/store/privacy-policy.md)
- [`docs/store/support.md`](./docs/store/support.md)
- [`docs/store/install-help.md`](./docs/store/install-help.md)
- [`docs/store/chrome-web-store-listing.md`](./docs/store/chrome-web-store-listing.md)
- [`docs/store/dashboard-submission.md`](./docs/store/dashboard-submission.md)
- [`docs/store/permissions-review.md`](./docs/store/permissions-review.md)
- [`docs/store/release-checklist.md`](./docs/store/release-checklist.md)
- [`docs/store/release-signoff-template.md`](./docs/store/release-signoff-template.md)
- [`docs/store/assets/README.md`](./docs/store/assets/README.md)
- [`docs/store/site/README.md`](./docs/store/site/README.md)
- [`.github/workflows/deploy-store-site.yml`](./.github/workflows/deploy-store-site.yml)

## Repo Layout

- `apps/api`: local API server used for dev and legacy flows
- `apps/extension`: Chrome extension
- `packages/contracts`: shared types and interfaces

## Recommended Local Models

For the default local setup, use:

- writing model: `qwen3:8b`
- OCR/image model: `minicpm-v`

These run locally through Ollama.

## Prerequisites

- Node.js `20+`
- npm
- Google Chrome or Chromium
- Ollama installed locally if you want the default local-model path

## Install

From the repo root:

```bash
npm install
```

## Local Model Setup

Start Ollama if it is not already running:

```bash
ollama serve
```

Pull the recommended models:

```bash
ollama pull qwen3:8b
ollama pull minicpm-v
```

Optional sanity checks:

```bash
ollama run qwen3:8b "Fix this sentence: i thing we a rre good to hgo"
ollama list
```

If `Validate Connection` works but `Generate Replies` returns `Forbidden`, Ollama is likely
blocking the Chrome extension origin. Use the extension ID shown in ReplyMate Settings and restart
Ollama with:

```bash
OLLAMA_ORIGINS=chrome-extension://<your-extension-id>
```

## Daily Development Flow

Recommended local development startup:

```bash
npm run dev:app
```

That starts:

- the local API on `http://localhost:3000`
- the extension watcher output in `apps/extension/dist`
- the dev-only loopback path for sensitive flows

In `npm run dev:app`, ReplyMate still uses the local API on loopback for development convenience. That is not the primary store path.

## Store-Like Extension Flow

For the actual extension-vault path, build the store-like extension bundle:

```bash
npm run build:store --workspace @replymate/extension
```

Then load or reload the unpacked extension from:

```text
apps/extension/dist
```

in `chrome://extensions`.

This store-like path does not require native-host registration for normal BYOK or local-model usage.

## Extension Settings

Open ReplyMate settings and configure:

### 1. Backend Connection

The `ReplyMate API Base URL` and optional token are mainly for dev and legacy loopback flows.

For local development, use:

```text
http://localhost:3000
```

For store-like extension-vault testing, the main sensitive path runs in the extension background.

### 2. Mode

Choose one:

- `Local Models`
- `Use Your Own API`

### 3. Provider Setup

If you choose `Local Models`, configure either:

- `Ollama`
- `Local OpenAI-compatible`

Typical local defaults:

- base URL: `http://127.0.0.1:11434`
- model: `qwen3:8b`

`Local OpenAI-compatible` is currently loopback-only:

- `localhost`
- `127.0.0.1`
- `::1`

If you choose `Use Your Own API`, configure one of:

- `OpenAI`
- `Anthropic`
- `Gemini`
- `OpenRouter`
- `Custom OpenAI-compatible`

You provide:

- model name
- provider API key
- optional base URL override for presets, or required base URL for custom OpenAI-compatible endpoints

### 4. Vault Setup

When you click `Apply Settings`, ReplyMate stores the provider key as encrypted vault data and clears the input field.

Expected vault behavior:

- passkey setup is preferred
- passphrase fallback is available
- reopening Settings does not reveal the raw key
- reloading the extension or restarting Chrome can relock ReplyMate because the background service worker may be unloaded

### 5. Validate Connection

Use `Validate Connection` after changing provider mode, model settings, or vault state.

Expected results:

- local mode: ReplyMate reports the selected local runtime as ready
- BYOK mode: ReplyMate reports the selected provider as ready
- TXT, DOCX, and PDF parsing are bundled into the extension
- image OCR depends on the active provider/model supporting vision input

### 6. Custom OpenAI-Compatible Hosts

For `Custom OpenAI-compatible`, ReplyMate requests one-time runtime host permission for that origin before use.

## Verification Checklist

### Automated checks

Run:

```bash
npm test --workspace @replymate/extension
npm run build --workspace @replymate/extension
npm run build:store --workspace @replymate/extension
npm run test:e2e:store --workspace @replymate/extension
npm run capture:store-assets --workspace @replymate/extension
npm run package:store --workspace @replymate/extension
npm run verify:fast
```

### Manual store-path checks

1. Build the store bundle:

```bash
npm run build:store --workspace @replymate/extension
```

2. Load `apps/extension/dist` in `chrome://extensions`.
3. Confirm Chrome shows no manifest error such as `Permission 'permissions' is unknown.`
4. Open ReplyMate Settings and confirm the runtime line shows the extension-vault path.
5. Choose `Use Your Own API`, enter a provider key, and set up the vault.
6. Click `Apply Settings`.
7. Reopen Settings and confirm the raw key is not displayed.
8. Validate the provider and generate a reply.
9. Reload the extension or restart Chrome.
10. Open the side panel again and confirm ReplyMate shows a clear unlock prompt instead of a generic runtime failure.

### Storage verification

From an extension page DevTools console, inspect storage:

```js
await chrome.storage.local.get(null)
await chrome.storage.sync.get(null)
await chrome.storage.session.get(null)
```

Expected result:

- no raw provider key appears in any extension storage area
- saved settings contain metadata only
- encrypted vault records may exist in `chrome.storage.local`

### Custom-host verification

For `openai_compatible_custom`:

1. Enter a custom HTTPS endpoint.
2. Click `Apply Settings` or `Validate Connection`.
3. Approve the one-time host-permission request.

Expected result:

- ReplyMate requests permission for that custom origin
- validation proceeds after approval

## Legacy and Dev Notes

- `npm run dev:app` remains the recommended developer workflow
- the local API and legacy native-host scripts remain in the repo for development and compatibility work
- they are not the primary store path for provider-key handling anymore

## Store-Readiness Notes

- Generic web support is part of the product scope, so the store build still requests broad `https://*/*` optional host access for custom providers
- browser-internal pages such as `chrome://` and `chrome-search://` remain unsupported by Chrome itself
- telemetry is off by default
- draft debug tracing is opt-in and not part of the normal user flow

## Tests And Verification

Targeted checks:

```bash
npm test --workspace @replymate/api
npm test --workspace @replymate/extension
npm run build --workspace @replymate/api
npm run build --workspace @replymate/extension
npm run build:store --workspace @replymate/extension
npm run test:e2e:store --workspace @replymate/extension
npm run capture:store-assets --workspace @replymate/extension
npm run package:store --workspace @replymate/extension
npm run verify:fast
```
