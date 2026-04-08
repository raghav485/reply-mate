# ReplyMate Store Launch Docs

This directory is the source of truth for Chrome Web Store launch materials and manual QA.

Use these files together:

- [`privacy-policy.md`](./privacy-policy.md): store-facing privacy policy for the extension-vault path
- [`support.md`](./support.md): user support and issue-reporting route
- [`install-help.md`](./install-help.md): public install and troubleshooting guide
- [`chrome-web-store-listing.md`](./chrome-web-store-listing.md): listing copy for the Chrome Web Store
- [`dashboard-submission.md`](./dashboard-submission.md): dashboard-ready copy for permissions, privacy, and listing fields
- [`permissions-review.md`](./permissions-review.md): permission rationale for store review and internal launch notes
- [`release-checklist.md`](./release-checklist.md): automated and manual launch QA matrix
- [`release-signoff-template.md`](./release-signoff-template.md): manual QA signoff template for the exact build being submitted
- [`assets/README.md`](./assets/README.md): screenshot and promo-asset generation notes
- [`site/README.md`](./site/README.md): deploy-ready static privacy and support pages for public URLs
- [`../../.github/workflows/deploy-store-site.yml`](../../.github/workflows/deploy-store-site.yml): GitHub Pages deploy workflow for the public store site

The production/store path described here is the extension-owned vault path:

- provider keys are stored only as encrypted vault data at rest
- decrypted keys live only in the background service worker
- Chrome service-worker unload can relock ReplyMate
- local-model requests run directly from the extension background
- BYOK cloud requests run directly from the extension background

Developer-only native-host and local API flows remain in the repo, but they are not part of the
public install story.
