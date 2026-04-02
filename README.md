# ReplyMate

ReplyMate is a free, local-first Chrome extension for drafting customer-facing replies inside Slack, Gmail, and similar web apps.

The product now has two user-facing modes:

- `Local Models`: run your own local model through Ollama or another local OpenAI-compatible endpoint
- `Use Your Own API`: connect your own OpenAI, Anthropic, Gemini, OpenRouter, or custom OpenAI-compatible account

ReplyMate does not bill or proxy your provider usage in those modes.

Provider-key handling now works like this:

- the extension stores provider metadata only
- your local ReplyMate API stores provider keys securely
- on macOS, secure storage uses the Keychain

Public store launch is still blocked until the same secure-storage story exists across every supported OS.

## Repo Layout

- `apps/api`: local API server
- `apps/extension`: Chrome extension
- `packages/contracts`: shared types and interfaces

## Recommended Local Stack

For the default local setup, use:

- writing model: `qwen3:8b`
- OCR/image parser model: `minicpm-v`

These run locally through Ollama.

## Prerequisites

- Node.js `20+`
- npm
- Google Chrome or Chromium
- Ollama installed locally if you want the default local-model path
- macOS if you want the current native `DOCX` / text-PDF extraction path

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

## Local API Config

ReplyMate loads local backend config automatically from:

1. `.env.example`
2. `.env.local` if it exists

For most local runs, `.env.example` is already enough.

If you want machine-specific overrides, create `.env.local` once:

```bash
npm run env:init
```

Important:

- the extension manifest currently allows backend calls only to `http://localhost:3000` and `http://127.0.0.1:3000`
- keep the ReplyMate API on port `3000` unless you also change the extension manifest

## Start The Free Product Stack

Recommended daily startup:

```bash
npm run dev:app
```

That starts:

- API on `http://localhost:3000`
- extension watcher output in `apps/extension/dist`

Then load or reload the unpacked extension from:

```text
apps/extension/dist
```

in `chrome://extensions`.

## Extension Settings

Open ReplyMate settings and configure:

### 1. ReplyMate API Base URL

Use:

```text
http://localhost:3000
```

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

When you click `Apply Settings`, ReplyMate sends that key to your local API for secure storage and clears it from extension storage.

### 4. Validate Connection

Use `Validate Connection` after changing the provider mode or model settings.

Expected results:

- local mode: ReplyMate reports your local drafting runtime as ready
- BYOK mode: ReplyMate reports your selected provider as ready
- evidence/parser may still report metadata fallback unless you also configured a dedicated OCR runtime locally

## Product Verification

### Local Models

1. Start `npm run dev:app`
2. Load the unpacked extension
3. In settings, choose `Local Models`
4. Set provider to `Ollama`
5. Set model to `qwen3:8b`
6. Validate connection
7. Open Slack or Gmail and generate a reply

Expected result:

- no ReplyMate sign-in is required
- generation works through the local model

### Use Your Own API

1. Start `npm run dev:app`
2. Load the unpacked extension
3. In settings, choose `Use Your Own API`
4. Pick a provider preset
5. Enter your model name and API key
6. Validate connection
7. Generate a reply

Expected result:

- no ReplyMate sign-in is required
- generation runs through your selected provider
- ReplyMate does not bill or proxy the usage

## Store-Readiness Notes

- Generic web support is part of the product scope, so the store build requests broad `https://*/*` host access.
- Browser-internal pages such as `chrome://` and `chrome-search://` remain unsupported by Chrome itself.
- Telemetry is off by default.
- Draft debug tracing is opt-in and not part of the normal user flow.

## Tests And Verification

Targeted checks:

```bash
npm test --workspace @replymate/api
npm test --workspace @replymate/extension
npm run build --workspace @replymate/api
npm run build --workspace @replymate/extension
npm run verify:fast
```
