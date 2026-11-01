# Velio: future scope and idea inbox

A living list. Add ideas to the **Idea inbox** at the bottom; they get sorted into scope later.

## Direction (decided)

- **Runners only.** Positioned against Nike Run Club and adidas Running, not Strava: no feed clutter, just running.
- **Local-only for the MVP.** No accounts. Accounts and sync come later.
- **MVP hooks (already built):** route-trace share video, smart insights after each run, privacy-first defaults, goals / streaks / personal bests.

## Parked features (post-MVP)

### 1. Shared runs (live sessions with friends)
Start a session, friends join, everyone sees each other's live location, with a fun way to compete.
- Needs: a realtime backend, session codes or lightweight identity, and background location. This conflicts with "local-only", so it waits for accounts.
- Competition modes to explore: ghost race, meet-in-the-middle, chase/tag, team distance race, "stay within X m of each other".
- Privacy: share only while the session is live, auto-expire, no history kept by default.
- Unverified: whether anyone already does the competition layer. Strava Beacon and Garmin LiveTrack share live location for safety, so the difference would be in the game, not the tracking. Research before committing to "no app does this".

### 2. Path creator (GPS art)
The user draws a simple shape and the app builds a runnable route that traces it.
- Accuracy is the hard part: streets constrain the shape. Likely approach is to try many positions, rotations and scales of the drawing over the local street network, route along the best fit, and show a similarity score. Needs a routing / map-matching API (several have free tiers).
- Also needs turn-by-turn guidance while running, plus an after-run "how close was your drawing" comparison.
- Prototype first as a draw-on-map preview with no promises about accuracy.

### 3. Voice commands (start / pause hands-free)
- Always-on listening drains battery and is unreliable with wind and earbud mics. Cheaper options first: auto-pause when the user stops moving, earbud button play/pause, lock-screen controls. Voice after those.
- Expo has no built-in speech recognition, so this likely means a community library and a development build. Verify before building.

### 4. Playlist / music
- Highest integration cost, lowest differentiation. Apple Music and Spotify each have their own SDKs, entitlements and licensing rules.
- Lighter path: deep-link to the user's music app and rely on lock-screen controls. A pace-matched playlist idea can come later.

## Open questions

- Which of the four ships first once accounts exist?
- Units: add a miles toggle before launch?
- Does the user's interview research change the order above?

## Idea inbox

<!-- Add new ideas below, one per bullet, with a date. -->
- (empty)
