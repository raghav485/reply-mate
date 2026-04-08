# ReplyMate Store Assets

Generate store assets from the store-like extension build, not the dev loopback build.

## Generate assets

Run:

```bash
npm run capture:store-assets --workspace @replymate/extension
```

That command rebuilds the store bundle and refreshes these generated PNGs:

- `replymate-settings-store.png`
- `replymate-workflow-slack-store.png`
- `replymate-workflow-gmail-store.png`
- `replymate-promo-small.png`
- `replymate-promo-marquee.png`

## What the generated assets show

- the live store-path Settings page with the first-run checklist
- a Slack workflow composite using the built-in Slack fixture and the real side panel
- a Gmail workflow composite using the built-in Gmail fixture and the real side panel
- two promo images assembled from the current store-path screenshots

## Capture rules

- use real store-path UI from `npm run build:store --workspace @replymate/extension`
- avoid showing raw provider keys, private customer text, or internal debug panels
- keep extension IDs blurred or cropped unless you intentionally want them visible
- verify the latest Chrome Web Store asset size requirements before uploading final PNG files
