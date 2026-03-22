# Deploy Notes — einHaru

## Skip a build
Add `[skip netlify]` anywhere in the commit message:
```
git commit -m "update readme [skip netlify]"
```

## Manual CLI deploy
```bash
# Draft preview (does not go live)
netlify deploy --dir=.

# Production deploy
netlify deploy --dir=. --prod
```

## What triggers a build
Only pushes to `main` that change deploy-relevant files trigger a build.
The following are ignored automatically:
- `*.md` files
- `.gitignore`
- `.DS_Store`
- `deno.lock`
- `scripts/`
- `.github/`

Branch deploys and deploy previews are disabled.
