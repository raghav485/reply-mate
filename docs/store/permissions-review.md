# ReplyMate Store Permission Review Notes

## Installed permissions

### `sidePanel`

Used to host the primary ReplyMate drafting UI alongside the active website.

### `activeTab`

Used to scope page interaction to the user’s current active tab when ReplyMate captures context,
refreshes the composer snapshot, or inserts a selected draft.

### `storage`

Used for:

- saved settings
- encrypted vault records and metadata
- workspace state
- feature flags

Raw provider keys are not stored in extension storage.

### `scripting`

Used to connect the page bridge, refresh capture state, and interact with supported composers in
the active website.

## Host access story

### Content-script scope

ReplyMate includes generic web support in v1, so the store manifest keeps `https://*/*` content
script coverage in addition to explicit Slack and Gmail matches.

Rationale:

- ReplyMate needs to detect and work with supported generic website composers without asking users
  to reinstall or switch builds
- composer detection is still bounded by runtime checks and active text-box focus
- browser-internal pages remain unsupported and are rejected explicitly

### Built-in provider hosts

ReplyMate includes explicit host permissions for built-in provider APIs and loopback local-model
endpoints so validation and generation can run directly from the extension background.

### Optional custom-host permissions

`optional_host_permissions` are used for `openai_compatible_custom`.

Rationale:

- broad host access is not granted upfront for custom providers
- ReplyMate asks Chrome for the exact origin only when the user explicitly configures a custom
  OpenAI-compatible endpoint

## Review notes

- ReplyMate does not require native messaging for the main store path
- provider keys are stored only as encrypted vault data at rest
- BYOK and local-model requests run directly from the extension background
- service-worker-loss relocking is intentional and user-visible
