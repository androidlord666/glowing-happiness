# Keystore Backup & Recovery (StakeNBake)

Keep this safe. Without the same keystore + alias + passwords, you cannot publish updates to the same app id.

## Files to back up

- `upload-keystore.jks`
- alias name (e.g. `upload`)
- keystore password
- key password
- base64 string used in GitHub secret (`ANDROID_KEYSTORE_BASE64`)

## Verify alias/password now

```bash
keytool -list -v -keystore ~/keystore/upload-keystore.jks
```

## Copy to phone storage (Termux)

```bash
termux-setup-storage
mkdir -p /storage/emulated/0/Download/stakeNbake-keystore
cp -v ~/keystore/upload-keystore.jks /storage/emulated/0/Download/stakeNbake-keystore/
```

## GitHub Actions secrets required

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

## Recovery checklist

1. Confirm alias exists in JKS with `keytool -list -v`.
2. Confirm passwords are correct locally.
3. Re-encode JKS if needed:
   ```bash
   base64 -w 0 ~/keystore/upload-keystore.jks > ~/keystore/upload-keystore.b64
   ```
4. Update all 4 GitHub secrets.
5. Re-run `android-release` workflow.
