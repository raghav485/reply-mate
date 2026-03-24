# ReplyMate

ReplyMate is a local-first Chrome extension for drafting customer-facing replies inside Slack, Gmail, and similar web apps.

This repo contains:

- a local API server in `apps/api`
- a Chrome extension in `apps/extension`
- shared contracts in `packages/contracts`

## Recommended Local Stack

For the current setup, use:

- Writing model: `qwen3:8b`
- OCR/image parser model: `minicpm-v`

These run locally through Ollama.

## Prerequisites

- Node.js `20+`
- npm
- Google Chrome or Chromium
- Ollama installed locally
- macOS if you want the current native `DOCX` / text-PDF extraction path

## Install Dependencies

From the repo root:

```bash
npm install
```

## Install Local Models

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

## Configure Local Defaults

ReplyMate now loads local backend config automatically from:

1. `.env.example`
2. `.env.local` if it exists

For most local setups, `.env.example` is already enough.

If you want your own machine-specific overrides, create `.env.local` once:

```bash
npm run env:init
```

Shell environment variables still override both files if you intentionally export them.

Important:

- The extension manifest currently allows backend calls only to `http://localhost:3000` and `http://127.0.0.1:3000`.
- Keep the ReplyMate API on port `3000` unless you also change the extension manifest.

## Daily Development Startup

From the repo root:

```bash
npm run dev:app
```

This starts:

- the API in watch mode
- the extension build/watch loop writing to `apps/extension/dist`

It also assumes:

- Ollama is already running
- your unpacked extension will be loaded or reloaded manually in Chrome

To verify the backend is reachable:

```bash
curl http://localhost:3000/v1/health
```

## Load the Extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `apps/extension/dist`

If the watcher rebuilds later, click `Reload` for the ReplyMate extension in `chrome://extensions`.

## Configure the Extension

Open the ReplyMate options page and set:

- `API Base URL`: `http://localhost:3000` (now the local default)
- `Bearer Token`: leave blank unless you separately add backend auth

Click `Validate Connection`.

Expected result for the recommended stack:

- Drafting runtime: `Ollama`
- Drafting status: `Ready`
- Drafting model: `qwen3:8b`
- Evidence parser: `Ready` if `minicpm-v` is installed

If the parser model is missing, drafting can still work while image OCR falls back or becomes unavailable.

## Advanced Manual Workflow

If you want to run pieces separately:

### API only

```bash
npm run dev:api
```

If you want a log file that Codex can inspect directly:

```bash
npm run dev:api:log
```

Default log path:

- `/tmp/replymate-api-dev.log`

### Extension only

Build once:

```bash
npm run build --workspace @replymate/extension
```

Watch and rebuild on change:

```bash
npm run dev:extension
```

If you want a log file that Codex can inspect directly:

```bash
npm run dev:extension:log
```

Default log path:

- `/tmp/replymate-extension-dev.log`

## Smoke Test

### Drafting test

In a Slack thread reply box:

1. Open ReplyMate
2. Make sure context diagnostics shows thread or channel context
3. Type:

   ```text
   i thing we a rre good to hgo
   ```

4. Click `Generate`

Expected result:

- `Cleaned Draft` fixes the sentence with minimal change
- `Context Reply` is the better sendable version
- if the two results are too similar, ReplyMate should still return best effort with warnings instead of a `502`

### Name correction test

If the correct name is clearly present in the Slack thread:

1. Type the name incorrectly in the draft
2. Click `Generate`

Expected result:

- both variants should use the corrected high-confidence name from context

### Image OCR test

1. Upload a screenshot in the Evidence panel
2. Click `Upload Evidence`

Expected result:

- with `minicpm-v` installed, image evidence should use OCR-backed extraction
- without it, the parser will degrade to metadata-only behavior

## File-Type Support

Current evidence behavior:

- Images: OCR through `minicpm-v`
- `DOCX`: native text extraction on macOS
- Text-based `PDF`: native text extraction on macOS
- Scanned or image-only `PDF`: degraded extraction warning

If you do not care about image OCR, you can switch the parser to metadata-only mode:

```bash
export REPLYMATE_PARSER_RUNTIME=metadata_local
```

## Test Commands

Run the fast repo gate:

```bash
npm run verify:fast
```

Run package-specific checks:

```bash
npm test --workspace @replymate/api
npm run build --workspace @replymate/api

npm test --workspace @replymate/extension
npm run build --workspace @replymate/extension
```

Run the full repo gate, including extension Playwright:

```bash
npm run verify
```

## Playwright E2E

The extension package includes a Playwright harness for local fixture-backed validation.

Install the extension package dependencies after pulling the latest repo changes:

```bash
npm install
npx playwright install chromium
```

Run the extension E2E suite:

```bash
npm run test:e2e --workspace @replymate/extension
```

Useful variants:

```bash
npm run test:e2e:headed --workspace @replymate/extension
npm run test:e2e:debug --workspace @replymate/extension
```

Notes:

- These tests use the built unpacked extension from `apps/extension/dist`.
- The API server is started automatically through Playwright `webServer`.
- Test artifacts are written to `apps/extension/test-results/`.
- The sidepanel regression harness expects the ReplyMate heading plus the stable connection/composer test hooks rendered by the sidepanel shell.
- Codex can inspect the log files above directly, but it cannot read Antigravity terminal scrollback itself.

## Draft Debug Probe

Use the manual draft probe when you want to inspect a single local improve-draft response outside the extension UI:

```bash
npm run debug:draft
```

## Common Problems

### Drafting is ready but OCR is not

Cause:

- `qwen3:8b` is installed
- `minicpm-v` is missing or named differently in Ollama

Check:

```bash
ollama list
```

Make sure the parser env matches the exact installed model name.

### Extension cannot reach the backend

Check:

- the API is running on port `3000`
- the options page uses `http://localhost:3000`
- the extension has been reloaded after rebuilding

### Generate is slow

This is usually one of:

- Ollama was cold and had to load the model
- the model is still downloading
- the local machine is under load

The backend now uses a `45000 ms` default drafting timeout and returns best-effort output for similarity-only quality problems.

## Notes

- ReplyMate is currently local-first.
- The recommended model stack in this repo remains `qwen3:8b` for writing and `minicpm-v` for OCR/images.
- The current extension build target is Chrome Manifest V3.
