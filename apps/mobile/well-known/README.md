# well-known

Templates for the two files a relying-party domain must serve so the native
app may use passkeys bound to it. Both must be public over HTTPS, as JSON,
with no redirect:

- `https://<rpId>/.well-known/apple-app-site-association` — replace `TEAM_ID`
  with the Apple team id.
- `https://<rpId>/.well-known/assetlinks.json` — replace `SHA256_FINGERPRINT`
  with each Android signing certificate's fingerprint. For a local debug build:
  `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`

`<rpId>` is the value of `EXPO_PUBLIC_RP_ID`, a host name without scheme or path.
