# TODOs

## Android test distribution and the Google Play background-location review

**What:** For stage 1, give Android testers the existing `preview` APK (sideload, no Google Play). Complete Google Play's background-location declaration before any public launch. Some Android phone makers kill background apps, so test on at least one non-Pixel phone.

**Why:** Expo's SDK 57 docs say enabling `ACCESS_BACKGROUND_LOCATION` or `FOREGROUND_SERVICE_LOCATION` requires a Google Play review and a permission request. A review delay could blow the two-week test window.

**Pros:** Keeps the test on schedule and records a launch task that is easy to forget.

**Cons:** Testers must allow installs from outside Google Play. The APK has no automatic store updates.

**Context:** `eas.json` profile `preview` builds an APK (`distribution: internal`). Source: Expo location docs (https://docs.expo.dev/versions/v57.0.0/sdk/location/). Origin: /plan-eng-review of the MVP test-build design doc, decision D12.

**Depends on / blocked by:** Whether any tester uses Android (unknown). Approved background-location work (R1).
