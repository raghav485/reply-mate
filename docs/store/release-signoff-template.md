# ReplyMate Store Release Signoff

Use this template to record the manual checks completed against the store-path bundle.

## Build under test

- Date:
- Branch:
- Commit:
- Chrome version:
- Tester:

## Store bundle checks

| Scenario | Status | Evidence / notes |
| --- | --- | --- |
| `npm run build:store --workspace @replymate/extension` passes | ☐ | |
| `npm run test:e2e:store --workspace @replymate/extension` passes | ☐ | |
| `npm run package:store --workspace @replymate/extension` passes | ☐ | |
| Store bundle loads in `chrome://extensions` without manifest errors | ☐ | |
| Settings shows the extension-vault store path | ☐ | |

## Security checks

| Scenario | Status | Evidence / notes |
| --- | --- | --- |
| Stored provider key is not visible in `chrome.storage.local` | ☐ | |
| Stored provider key is not visible in `chrome.storage.sync` | ☐ | |
| Stored provider key is not visible in `chrome.storage.session` | ☐ | |
| Reopening Settings does not reveal the raw provider key | ☐ | |
| Reloading the extension relocks the vault cleanly | ☐ | |

## Public launch matrix

| Scenario | Status | Evidence / notes |
| --- | --- | --- |
| Slack workflow | ☐ | |
| Gmail workflow | ☐ | |
| Generic site workflow 1 | ☐ | |
| Generic site workflow 2 | ☐ | |
| Ollama local-model path | ☐ | |
| Preset BYOK provider path | ☐ | |
| Custom OpenAI-compatible provider path | ☐ | |
| TXT evidence flow | ☐ | |
| DOCX evidence flow | ☐ | |
| PDF evidence flow | ☐ | |
| Image evidence flow | ☐ | |

## Required UX scenarios

| Scenario | Status | Evidence / notes |
| --- | --- | --- |
| Validate and generate succeed after setup | ☐ | |
| Custom-host permission prompt appears for a custom provider | ☐ | |
| Side Panel shows a clear unlock prompt after relock | ☐ | |
| Browser-internal pages stay unsupported without poisoning panel state | ☐ | |

## Store listing assets

| Scenario | Status | Evidence / notes |
| --- | --- | --- |
| Privacy-policy page is publicly reachable | ☐ | |
| Support page is publicly reachable | ☐ | |
| Screenshots are current and match the store-path build | ☐ | |
| Promo images match current Chrome Web Store size requirements | ☐ | |
| Final upload ZIP was created after the last `build:store` | ☐ | |
