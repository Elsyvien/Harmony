# Voice Audio Unlock QA

## Goal
Verify that WebAudio contexts are only started after a user gesture and that autoplay-policy console noise is gone.

## Environments
- Chrome (desktop, latest stable)
- Safari on iPad (latest iPadOS)

## Precondition
- Open Harmony in a fresh tab/session.
- Open DevTools console.
- Do not click anything yet.

## Test 1: No-gesture idle
1. Wait 10-15 seconds after initial page load.
2. Confirm there is no recurring error like:
   - `The AudioContext was not allowed to start...`

Expected:
- No repeated autoplay-policy error spam while idle.

## Test 2: First gesture unlock
1. Perform exactly one user gesture (for example click `Join Voice`).
2. Open Admin -> `Voice/Streaming Test Menu`.
3. Run `AudioContext State` test.

Expected:
- Test result is `PASS`.
- Message includes `Audio unlocked` and context state summary.

## Test 3: Voice join flow
1. Join a voice channel with at least one additional participant.
2. Toggle `Mic Live` / `Mic Muted`.
3. Start and stop `Share Screen` or `Share Camera`.

Expected:
- Voice/stream functions work normally.
- No autoplay-policy errors appear from these actions.

## Test 4: Passive behavior safety
1. Stay connected in voice without additional clicks.
2. Let remote participants talk/stream.

Expected:
- No background loop of `AudioContext not allowed` warnings.
- Remote audio/stream display remains stable once unlocked.

## Regression Notes
- If audio is blocked until interaction, this is acceptable before first gesture.
- After first gesture, audio contexts should stay in `running` or recover to `running` on demand.
