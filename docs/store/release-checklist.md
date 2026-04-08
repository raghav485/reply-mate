# ReplyMate Public v1 Release Checklist

## Automated checks

Run:

```bash
npm test --workspace @replymate/api
npm test --workspace @replymate/extension
npm run build --workspace @replymate/extension
npm run build:store --workspace @replymate/extension
npm run test:e2e:store --workspace @replymate/extension
npm run capture:store-assets --workspace @replymate/extension
npm run package:store --workspace @replymate/extension
npm run verify:fast
```

## Store-like install checks

1. Build the store bundle:

```bash
npm run build:store --workspace @replymate/extension
```

2. Load `apps/extension/dist` in `chrome://extensions`.
3. Confirm there are no manifest errors.
4. Open ReplyMate Settings and verify the extension-vault path is shown.
5. Record the result in [`release-signoff-template.md`](./release-signoff-template.md).
6. Create the upload ZIP with `npm run package:store --workspace @replymate/extension`.

## Security checks

1. Set up the vault with passkey or passphrase.
2. Store a provider key.
3. Confirm the raw key does not appear in:
   - `chrome.storage.local`
   - `chrome.storage.sync`
   - `chrome.storage.session`
4. Confirm reopening Settings does not reveal the raw key.

## Public launch manual matrix

Test at least:

- Slack
- Gmail
- two generic websites you plan to mention publicly
- Ollama local models
- one preset BYOK provider
- one custom OpenAI-compatible provider
- TXT, DOCX, PDF, and image evidence flows

## Required manual scenarios

- validate and generate successfully after setup
- custom-host permission prompt appears for `openai_compatible_custom`
- Ollama local generation works when extension-origin access is configured
- vault relocks after extension reload or browser restart
- Side Panel shows a clear unlock prompt after relock
- browser-internal pages remain unsupported without poisoning panel state

## Launch notes

- Treat the large `background.js` bundle warning as a follow-up cleanup item unless it becomes a
  store-review or runtime-stability problem.
- Capture screenshots and promo assets from the store-like build, not `npm run dev:app`.
- Publish the files in [`site`](./site/README.md) before entering privacy-policy and support URLs in
  the dashboard.
- Upload the ZIP from `apps/extension/store-artifacts/`, not the unpacked `dist` directory.
