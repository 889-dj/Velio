# Run tracker: research synthesis and design direction

Research: 10 Haiku agents across running-app teardowns, activity apps, Dribbble/Behance, UI galleries, motion,
visual identity, user complaints, design critiques, tracking feasibility, and map styling. Plus a manual look at
Strava's free Mobbin screens. Many sources blocked or thin; confidence is marked. Brand hex values come from
third-party aggregators unless stated.

## What the research agrees on

1. **Live screen = full-bleed map + stats sheet + split banner.** (Strava Record redesign, Kombai Paceloop, Mobbin Strava free screens). No toggling between a map page and a data page.
2. **2-3 huge fixed numbers** on the live screen (time, distance, pace), not a grid of equal cards. Users asked for fixed glanceable metrics (Strava community, 2015+ and recurring).
3. **Explicit Pause and Finish as separate controls.** Finish needs a deliberate gesture (hold) plus feedback. Big single-tap pause caused accidental pauses; swipe-to-pause confused people (Adidas, Hermes study, Strava community).
4. **Never lose a run.** Top Strava complaint (~26% of 152 sampled low-star Play reviews, single third-party sample): recording not saved. Second (~25%): GPS cut out leaving straight-line gaps. Autosave every point locally; show gaps as gaps.
5. **Show GPS quality** before and during the run (wrong-distance complaints, 27 reviews in the same sample).
6. **Route needs contrast:** dark casing under a bright line, hue distinct from the basemap, muted basemap. Direction arrows or markers, not colour alone.
7. **Generic trap:** dark + neon accent + grid of identical stat cards is the most common Dribbble look. Differentiate with route rendering and number typography.
8. **No paywalls in the core flow.** Major complaint driver.
9. **Empty states teach** (sample route / goal ghost card). Onboarding 2-3 screens max.
10. **Colour carries meaning, not decoration** (Whoop, Oura): one accent for progress/CTA, status colours only for status.

## Direction options (all contrast-checked by the agent; fonts on Google Fonts)

| | A. Athletic dark | B. Editorial light | C. Premium glass |
|---|---|---|---|
| bg / surface | #0B0B0C / #17181B | #F7F3EE / #FFFFFF | #0E1116 / #171B22 @70% |
| text / muted | #F5F5F5 / #9A9DA5 | #1C1A17 / #6E675E | #EEF2F7 / #8B95A5 |
| accent | #C6FF3D (lime) | #C2410C (burnt orange) | #2DD4BF (teal) |
| display font | Barlow Condensed 700 | Fraunces 600 (headlines) | Sora 600 |
| UI font | Inter | Manrope | Manrope |

Strava-orange note: #FC4C02 is Strava's brand colour; black text on it ~5.8:1 passes AA, white on it ~3.4:1 fails body text.
Do not use Strava's logo/wordmark or imply endorsement; app needs its own name and icon before release.

Recommendation: **A** (matches what the user already saw and approved as "okayish"), but the route and numerals must carry
the identity: pace-coloured route with casing + glow, condensed numerals in fixed-width cells, one signature moment on finish.

## Screen specs

### Home
- One dominant **Start** control in the thumb zone, with a **sport chip** (Run / Walk) and a GPS-ready indicator.
- Hero: one weekly number + ring (Whoop "one score, tiers of disclosure"), tap for trend.
- Weekly streak, forgiving (Hevy / Gentler Streak): rest days do not reset it.
- Last activity card with its real route; personal bests that link to the activity that set them.
- Empty state: ghost route + "Your first run lands here", never a blank dashboard.
- Day-one "building baseline" state for stats that need history.

### Tracking
- Full-bleed muted map, route = casing (dark, wide) + line (accent) + faint glow; start and finish markers; direction cue.
- Top: giant distance. Sheet: time, current pace, avg pace/cadence; steps secondary.
- GPS chip (Good / Weak / Lost) with a banner and recovery on loss.
- Controls: Pause (large, 60px+), Resume, Finish by hold (~1.1s) with escalating haptics. Cancel is visible.
- Split card on each km (matches Strava's "Split N complete").
- Finish: summary with map fit, stats, splits bars; Save is local-first.
- Keep screen awake while recording.

## Tracking engineering (Expo SDK 57 docs)
- expo-location: `Accuracy.High`, `distanceInterval` ~5m. Avoid BestForNavigation (battery). `timeInterval` is Android-only.
- Filter fixes: drop accuracy worse than ~20m, min spacing, speed-jump guard.
- Pace: ~5s rolling window from distance/time, not raw GPS speed (30-60s was too slow).
- Elevation gain: threshold ~10m for GPS-only; keep raw track.
- Pedometer: steps only (no distance). Use for cadence; calibrate stride against GPS as a GPS-loss fallback.
- Autosave each point locally; recover interrupted run on next launch.
- Background tracking (screen locked) needs TaskManager + a **development build**; not supported in Expo Go on iOS.
- Auto-pause: no source found for thresholds. Use hysteresis (pause below low speed for several seconds, resume above a higher one). Thresholds are my own guess; label as such.
- react-native-maps works in Expo Go with the default provider; Google tiles need keys + a dev build. Test polylines on a real device (one report of overlays not drawing on-device while fine in simulator).

## Motion spec
Sourced: ring tick ~300ms ease-out, press scale 0.96 (third-party draft); route draw-in via stroke-dashoffset; escalating haptics on hold.
My own choices (not sourced): countdown 3-2-1 at 900ms with medium haptics; count-up ~1300ms ease-out; hold-to-finish ~1100ms linear fill with snap-back 220ms;
screen transition 300-350ms. Reduce Motion: fade only.
Not covered by sources: pause/resume morph, bottom-sheet springs, split celebration, home to tracking transition.

## Anti-patterns
Swipe-to-pause; hidden gestures on the map; small recenter / clustered tiny icons; translucent cards behind text; bare dashboard;
12-step onboarding; paywall in the core flow; two tints of one hue for route progress; pure #000 background.

## Gaps and confidence
- Mobbin Strava: only the free first row seen (record screen, split card, activity detail, onboarding).
- Dribbble/Behance: no verified hex/fonts. Refero needs login. Several galleries failed to load.
- Motion: 60fps and Codrops shot pages blocked; most motion values are mine.
- Sunlight/glove/one-hand evidence: none found; apply 44px+ targets and high contrast as hypothesis.

---

# Addendum: Activity Detail (insights) screen

Research round 2 (6 Haiku agents): leader apps, chart design, insight formulas, galleries, motion, runner complaints.
Thin spots: Dribbble/Behance pages came back empty; no chart sizes/hexes were sourced (mine); motion values partly mine.

## Layout (top to bottom)
1. Map hero (330pt): route, start/finish markers, "Pace colours" toggle, back + delete. Title and date overlaid on a bottom fade.
2. Headline trio: distance, time, avg pace (condensed numerals, fixed-width cells). PR badges below (Fastest km, Longest run, First activity).
3. "What we noticed": up to 5 plain-language, rule-based insights (split verdict, fastest/slowest km, climb context, cadence trend, vs similar runs).
4. Pace chart (Pace | Speed toggle, faster = up, dashed average, drag to scrub; scrubbing moves a marker on the map).
5. Splits: zero-based speed bars, average tick, delta column. Tap a km to highlight and zoom it on the map.
6. Elevation: area chart + gain/loss/high/low, labelled as an estimate.
7. Cadence: line + dashed average, typical-range note.
8. Details table (key/value rows, not identical tiles) incl. calories estimate with editable weight.

## Decisions taken from the research
- Highlight-the-section linking between chart/splits and map (Strava, COROS); route colour by pace as a toggle (Apple, Garmin).
- Splits bars start at zero (Datawrapper); labels in plain language; 3:1 non-text contrast for lines/bars.
- Pace axis: faster is up, with a visible Pace/Speed toggle (Garmin's silent inversion is a known complaint).
- Elevation: smoothed (+/-2 samples) then 3 m hysteresis; labelled "estimated, filtered"; flagged when implausibly high (>50 m/km).
- Calories: 1.0 kcal/kg/km running (0.5 walking), shown as an estimate (+/-20%), never a headline number; weight editable, stored on device.
- No unexplained "effort score". Instead: pace vs your last 5 similar runs (needs >= 2).
- Hills note on pace when climb > 15 m/km (raw pace on hills reads like a fitness drop).
- Nothing paywalled.

## Thresholds (sourced vs mine)
- Even split within +/-2% (coaching literature, secondary). Pacing variability = CV of per-km pace; Steady <3%, Moderate <6%, Variable >=6% (cut-offs are mine).
- Pace window ~100 m, bucketed to 80 points (mine). Elevation smoothing/deadband values (mine).
- Cadence 160-180 spm is a recreational range, not a target; compare with the runner's own average.

## Data model additions
`Run.track` = [moving ms, cumulative m, altitude] per accepted GPS fix; `Run.cadence` = [moving ms, spm] about every 4 s.
Older runs lack both, so they show splits and totals only, with a note on the pace card.

## Not built / honest gaps
Grade-adjusted pace (Minetti polynomial unverified), heart rate, share card, per-km map colouring by elevation,
shared-element transition (experimental flag), editable metric slots.

---

# Addendum: Share video

Research round 3 (4 Haiku agents): video-export feasibility, share-video design in running apps, sharing APIs and social
formats, route-animation motion. Thin spots: no published durations/ratios/colours for Strava/Relive; easing values are mine.

## What it is
A 10 s, 9:16 (360x640 pt, exported 1080x1920, 30 fps, H.264 MP4) animation: faint street grid, route draws itself with a
glowing comet head, distance and time count up in sync, avg pace and climb appear at the end, small wordmark.
Preview and export render the same React component as a pure function of progress `p`, so what you see is what you share.

## Timeline (fractions of 10 s)
0-0.07 title fades in. 0.08-0.78 route draws, ease-in-out cubic (about 7 s). 0.78-0.90 avg pace appears. Then the head dot
pulses until the end. All values are my starting points, not sourced.

## Decisions from the research
- Export with `react-native-view-recorder` (MIT, AVAssetWriter / MediaCodec, frame-by-frame). ffmpeg-kit is retired; Remotion is not for on-device use.
- It needs a development build; in Expo Go the screen detects the missing native module and shares a still image of the finished card instead.
- Privacy (Strava inherits privacy zones; Garmin users ask for hide-map): "Hide start and finish" on by default, cuts the first and last 200 m; skipped for routes under 800 m, with an explanation. Stats are individually toggleable. Nothing is posted anywhere automatically.
- Text kept inside the 9:16 safe area (top 14% and bottom 20% free of key text; research figures conflict, verify on device).
- Share via the system sheet (expo-sharing), plus Save to Photos (write-only permission). Direct Instagram Stories sharing was left out: no verified video key.

## Not verified
The native MP4 encode has not been run: this Mac cannot build a development build (SDK 57 needs Xcode 26.4+; this machine has Xcode 15.2,
and no Java for Android). WhatsApp/iMessage/Instagram size limits are unverified; export is a short H.264 clip to stay well inside typical limits.

---

# Addendum: Account screen

Research round 4 (6 Haiku agents): category leaders, user pain, galleries, privacy/data patterns, feasibility, critique.
Thin spots: every gallery page (Dribbble, Mobbin, Refero) was JS-rendered and empty, so there are no measured pixel values;
non-Strava leaders came from search snippets only; store reviews were not read (complaint evidence is mostly 2016-2019 news/forums);
the feasibility agent found no sourced motion values, so all motion below is mine.

## What it is
The app is local-only (no login, no backend), so "account" = a **profile hub on the device**: identity, lifetime totals,
goals/body, privacy default, permissions, your data (export / delete). No sign-in, subscription or social rows: they would be fake.

## Layout (one scroll, grouped; reached from the Home avatar)
1. Header: back, title. Avatar (initials on a stable per-name colour, lime ring), tap-to-edit name, "Member since".
2. Lifetime strip (three-up, condensed numerals): activities, distance, moving time. Computed from saved runs.
3. Group **Goals and body**: weekly distance goal stepper (drives the Home ring), weight stepper (drives the calorie estimate).
4. Group **Privacy**: "Hide start and finish" default (on). Copy says it applies to new share videos, as a default.
5. Group **Permissions**: Location and Motion rows with live status; Allow, or Open Settings if it can't ask again. Copy: location is only used while recording.
6. Group **Your data**: Export everything (JSON via the share sheet).
7. Group **Danger**: Delete all data, last, red. Opens a confirm sheet: says what is removed, offers Export first, requires typing DELETE.
8. Footer: app version, "Stored only on this device".

## Decisions from the research (sources)
- Settings entry from the profile/"You" area, not a tab (Strava help https://support.strava.com/en-us/articles/15402087-iphone-app-settings).
- Group the list, don't ship one flat scroll of toggles (same Strava page; Android guidance "10-15 items overwhelming" https://source.android.com/devices/tech/settings).
- Identity, then totals strip, then settings (https://www.appetiteui.com/docs/screens-fitness).
- Rows about 52 pt, 44 pt minimum, whole row is the tap target (same appetiteui page; third-party iOS demos, guessed).
- Privacy default is private; Strava's public default is a top complaint (https://qz.com/1191431/strava-privacy-concerns-here-is-how-to-safely-use-the-app). Default applies to new shares only, stated in copy (https://communityhub.strava.com/insider-journal-9/hiding-your-activity-map-from-others-1516).
- Export exists and is easy to find (Nike Run Club users complain it doesn't: https://www.cultofmac.com/?p=488424). Machine-readable JSON (https://gdpr-info.eu/art-20-gdpr/).
- Delete is a separate bottom section, says what is and isn't removed, offers export first, verb-named buttons not OK (https://www.nngroup.com/articles/confirmation-dialog/, https://support.strava.com/en-us/articles/15401906-delete-your-strava-account). Typed confirmation only for wipe-all (NN/g).
- Permission rows deep-link to OS settings via Linking.openSettings (feasibility agent, Expo docs https://docs.expo.dev/versions/latest/sdk/linking.md).
- Initials avatar with stable colour and accessibility label (https://design.rogo.ai/avatar).
- Stepper beside a visible value with unit, disabled at min/max (https://setproduct.com/blog/stepper-ui-design; snippet only).

## Tokens (guessed from the thin research, built from existing theme)
Group surface `colors.surface`, hairline border, radius 20 (`radius.md`); row min height 52; icon chip 30 px, radius 9, tinted by `accentDim`
(danger tint for destructive); section caption = existing `label` style; avatar 84 px; danger text `colors.danger`.

## Motion (all mine, not sourced)
Staggered fade-in-down 60 ms apart (same as Home); row press scale 0.98 / 120 ms; selection haptic on switch and stepper;
success haptic on export; warning haptic when the delete sheet opens; Reduce Motion: no entering animation.

## Anti-patterns avoided
Public default; one flat 20-row list; "Are you sure?" with OK; hidden export; dead rows (units, notifications, subscription, connected apps were left out because there is nothing behind them).

## Not built / honest gaps
Units (km/mi) switch: would have to be threaded through every screen's formatting, so it is not faked. Avatar photo (needs image picker + a rebuild
of plugin config). GPX export. Editing past activities' privacy. Email-confirmed deletion (no backend).
