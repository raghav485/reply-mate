# ReplyMate Chrome Web Store Listing Copy

## Short description

Draft customer-facing replies in Slack, Gmail, and the web using local models or your own AI API.

## Detailed description

ReplyMate helps you draft better replies directly inside Slack, Gmail, and similar web apps without
forcing you into a hosted AI subscription.

Choose the model path that fits your setup:

- `Local Models`: connect Ollama or another loopback OpenAI-compatible runtime
- `Use Your Own API`: use OpenAI, Anthropic, Gemini, OpenRouter, or a custom OpenAI-compatible API

ReplyMate is built to keep provider access local to the extension:

- saved provider keys are stored only as encrypted vault data at rest
- decrypted keys live only in the background while Chrome keeps ReplyMate alive
- passkey unlock is preferred, with passphrase fallback when needed

What you can do:

- improve the current draft or generate a reply from context
- keep the workflow inside the active website instead of switching tabs
- upload TXT, DOCX, PDF, or image evidence for additional context
- use local models for privacy-sensitive workflows

Expected behavior:

- Chrome can unload the ReplyMate background service worker
- when that happens, ReplyMate relocks and may ask you to unlock again before using stored BYOK keys

## Suggested highlights

- Local-first workflow
- Bring-your-own-model flexibility
- Encrypted local vault for saved provider keys
- Works inside Slack, Gmail, and generic websites with supported composers

## Store screenshots callouts

Use screenshots that show:

- Settings with the first-run checklist and vault state
- Side Panel with captured context and draft generation
- local-model setup guidance
- vault relock / unlock recovery flow
