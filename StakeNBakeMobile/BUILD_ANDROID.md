# Android Build (APK) Guide

## Prereqs
- Node 20+
- JDK 17
- Android SDK + platform tools
- React Native Android toolchain

## Install
```bash
npm install
```

## Debug run
```bash
npm run android
```

## Release build (unsigned)
```bash
cd android
./gradlew assembleRelease
```

APK output:
`android/app/build/outputs/apk/release/app-release.apk`

## Signed release (for store)
1. Create/import keystore
2. Configure `android/gradle.properties`:
   - `MYAPP_UPLOAD_STORE_FILE`
   - `MYAPP_UPLOAD_KEY_ALIAS`
   - `MYAPP_UPLOAD_STORE_PASSWORD`
   - `MYAPP_UPLOAD_KEY_PASSWORD`
3. Wire signing config in `android/app/build.gradle`
4. Build:
```bash
cd android
./gradlew assembleRelease
```

## Notes
- Current app is set to `devnet` by default.
- Switch to mainnet by editing `src/config.ts` cluster/RPC settings.
