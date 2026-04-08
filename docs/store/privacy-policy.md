# ReplyMate Privacy Policy

Last updated: April 7, 2026

## Overview

ReplyMate is a local-first Chrome extension for drafting replies inside Slack, Gmail, and other web
apps. The main public store path keeps sensitive provider access local to the extension.

## What ReplyMate stores

ReplyMate stores:

- extension settings such as selected provider mode, model name, feature flags, and preferences
- encrypted vault records for provider keys when you choose to store a key for reuse
- workspace state needed to restore drafts, evidence status, and UI state

ReplyMate does **not** store raw provider API keys in saved settings, `chrome.storage.sync`, or
`chrome.storage.session`.

## How provider keys are handled

When you choose to save a provider key:

- the key is encrypted before it is written to extension storage
- only ciphertext and vault metadata are stored at rest
- decrypted keys live only in the extension background service worker while it remains active
- Chrome can unload the background service worker, which relocks ReplyMate until you unlock again

ReplyMate supports passkey-first unlock and passphrase fallback for the local encrypted vault.

## What content ReplyMate can process

ReplyMate may process:

- the visible draft text in the active composer
- nearby message context captured from supported pages
- uploaded evidence files such as TXT, DOCX, PDF, and images

TXT, DOCX, and PDF parsing run in the extension for the main store path. Image OCR depends on the
active local or cloud model path you select.

## Where model requests go

ReplyMate can send requests:

- to a local model runtime you control, such as Ollama or a loopback OpenAI-compatible endpoint
- directly to a cloud provider you configure, such as OpenAI, Anthropic, Gemini, OpenRouter, or a
  custom OpenAI-compatible API

ReplyMate does not proxy your model traffic through a ReplyMate-managed cloud service in these
store-path modes.

## Telemetry

Telemetry is optional and off by default. If you enable it, ReplyMate may send coarse diagnostic
events to the configured ReplyMate backend path. The product should not log raw provider keys or
raw decrypted vault contents.

## Website permissions

ReplyMate uses website access to detect supported text boxes, capture local context from supported
surfaces, and insert drafts back into the active composer. Custom provider host access is requested
only when you explicitly configure a custom OpenAI-compatible endpoint.

## Your choices

You can:

- avoid saving a provider key and enter it only when needed
- remove stored encrypted provider credentials from Settings
- disable optional telemetry
- use local models instead of cloud providers

## Support

For support or privacy questions, use the support route documented in
[`support.md`](./support.md).
