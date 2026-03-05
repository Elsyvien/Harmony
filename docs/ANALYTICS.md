# Analytics And Privacy

This document defines Harmony analytics taxonomy, ingestion contract, retention, and privacy boundaries.

## Goals

- Reliability and debugging telemetry for API, websocket, and voice flows.
- Product usage/funnel visibility for auth, messaging, and friends.
- Moderation activity visibility in admin analytics.
- Operational volume and latency trend visibility.

## Event Taxonomy

- Naming format: `domain.action.result` (for example `voice.join.failed`).
- Categories:
  - `reliability`
  - `usage`
  - `moderation`
  - `operations`
- Levels:
  - `info`
  - `warn`
  - `error`

## Ingestion

- Endpoint: `POST /analytics/events`
- Body: `{ "events": AnalyticsEventEnvelope[] }`
- Limits:
  - Max `50` events per request.
  - Max request payload size `64KB`.
  - Rate limit `120` requests/minute (per user/IP window).

### Envelope

- Required:
  - `name`
  - `category`
  - `level`
- Optional:
  - `timestamp`
  - `source` (`web_client`)
  - `sessionId`
  - `requestId`
  - `channelId`
  - `success`
  - `durationMs`
  - `statusCode`
  - `context`

## Admin Analytics Endpoints

- `GET /admin/analytics/overview?window=24h|7d|30d&category=<optional>&name=<optional>`
- `GET /admin/analytics/timeseries?window=24h|7d|30d&category=<optional>&name=<optional>`

## Retention

- Analytics retention window: `30 days`.
- Cleanup job runs every `6 hours`.

## Privacy Policy Surfaces

- Public policy page: `/privacy` (frontend route).
- Visible links:
  - Auth form (`/login`, `/register`)
  - User Settings > About section
- Policy mode is informational only in this phase:
  - no registration blocking
  - no consent version persistence

## Data Minimization Rules

- No message body content in analytics.
- No raw file payloads or media stream payloads in analytics.
- No raw SDP/ICE blobs in analytics.
- Allowlisted context keys only; unknown keys are dropped at ingestion.
