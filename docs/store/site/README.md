# ReplyMate Public Store Site

This folder is a static-hosting copy of the store-facing privacy and support pages.

Use it when you need public URLs for the Chrome Web Store dashboard:

- `index.html`: lightweight landing page
- `privacy-policy.html`: privacy-policy URL
- `support.html`: public support URL

Recommended publishing options:

1. GitHub Pages for this repository
2. Netlify, Vercel, or any static host
3. An existing replymate.app/docs path if you already have one

## GitHub Pages default path

This repo now includes a GitHub Pages workflow at
[`../../.github/workflows/deploy-store-site.yml`](../../.github/workflows/deploy-store-site.yml).

Default GitHub Pages flow:

1. Push the workflow and `docs/store/site` changes to `main`
2. Enable GitHub Pages in the repository settings with `GitHub Actions` as the source
3. Wait for the workflow to publish the site

If you use the default GitHub Pages host, the URLs will look like:

- `https://<owner>.github.io/<repo>/`
- `https://<owner>.github.io/<repo>/privacy-policy.html`
- `https://<owner>.github.io/<repo>/support.html`

This repository's current remote suggests the default host would likely be:

- `https://raghav485.github.io/reply-mate/`

After publishing, update the final URLs in the Chrome Web Store dashboard and in
[`dashboard-submission.md`](../dashboard-submission.md).
