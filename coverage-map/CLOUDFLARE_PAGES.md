# Cloudflare Pages Deployment

This app is a static Vite site, so it can be deployed for free on Cloudflare Pages without adding a backend.

## Recommended Project Settings

- Production branch: `main`
- Framework preset: `Vite`
- Root directory: `coverage-map`
- Build command: `pnpm build`
- Build output directory: `dist`
- Node.js version: `22`

## Create the Project

1. Open Cloudflare Dashboard.
2. Go to `Workers & Pages`.
3. Click `Create application`.
4. Choose `Pages`.
5. Connect the GitHub repository `juliennigou/panoramax-sign-detection-display`.
6. Use the project settings above.
7. Deploy.

## Notes

- No runtime environment variables are required for the current app.
- The app uses hash-based view switching for the map and review page, so no SPA redirect rule is needed.
- The current frontend assets are committed in `coverage-map/public/data/`, so Cloudflare only needs to build and publish the static site.

## Updating Data

When you regenerate the Panoramax assets locally, commit the refreshed files and push to `main`. Cloudflare Pages will rebuild automatically.

```bash
python3 scripts/generate_coverage_map_assets.py
python3 scripts/run_sign_poc_inference.py
python3 scripts/generate_sign_map_assets.py
git add .
git commit -m "Refresh coverage and sign assets"
git push
```
