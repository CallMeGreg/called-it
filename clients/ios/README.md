# Legacy SwiftUI reference

This is a small, unvalidated iOS scaffold targeting iOS 16+. It is **not the
approved launch client**: the owner selected React Native/Expo native builds for
both iOS and Android on 2026-10-07. Preserve this source as reference only.

The scaffold contains a Today screen, hand-written DTOs and transport/session
examples. It does not provide production social sign-in, Keychain storage,
complete push registration, robust error handling or deadline reconciliation.
Do not ship it or follow its old contact-pepper approach.

For optional local exploration, Xcode and XcodeGen are required:

```bash
cd clients/ios
xcodegen generate
open CalledIt.xcodeproj
```

Generation is not a successful native build or App Store certification.
See [the client direction](../README.md), [UX/UI](../../docs/ux-ui.md), and
[delivery plan](../../docs/delivery-plan.md) for current requirements.
