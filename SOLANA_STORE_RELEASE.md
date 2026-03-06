# Solana Mobile Store Release (GitHub Actions)

This repo is configured to produce a **signed release APK** via:
- `.github/workflows/android-release.yml`

## 1) Add GitHub Actions secrets

In GitHub repo settings:
`Settings -> Secrets and variables -> Actions -> New repository secret`

Add all four:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### Build `ANDROID_KEYSTORE_BASE64`

From Termux (or any shell), run:

```bash
base64 -w 0 ~/keys/my-release-key.jks > keystore.base64.txt
```

Copy the file contents into `ANDROID_KEYSTORE_BASE64`.

If `-w` is unsupported:

```bash
base64 ~/keys/my-release-key.jks | tr -d '\n' > keystore.base64.txt
```

## 2) Trigger release build

- Go to `Actions -> android-release`
- Click `Run workflow`
- Select `main`

or push to `main` with changes under `StakeNBakeMobile/**`.

## 3) Download output APK

Artifact name:
- `stakeNbake-release-apk`

Contains:
- `app-release.apk`
- `app-release.apk.sha256`

## 4) Verify APK locally (optional but recommended)

```bash
apksigner verify --verbose --print-certs app-release.apk
sha256sum app-release.apk
cat app-release.apk.sha256
```

## 5) Submit to Solana Mobile dApp Store

Use: <https://publish.solanamobile.com>

Required upload bundle:
- Signed APK (`app-release.apk`)
- Listing metadata (title/description/category)
- App icon + screenshots
- Publisher wallet connected with enough SOL

## Notes

- Keep keystore + passwords backed up securely.
- Never commit keystore files or passwords to git.
- For every new app update, increment `versionCode` in `StakeNBakeMobile/android/app/build.gradle`.
