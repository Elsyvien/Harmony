import { Link } from 'react-router-dom';

const POLICY_VERSION = '2026-03-05';

export function PrivacyPage() {
  return (
    <main className="auth-page">
      <article className="auth-card privacy-card">
        <h1>Privacy Policy</h1>
        <p className="auth-subtitle">Version {POLICY_VERSION}</p>

        <section className="privacy-section">
          <h2>What We Collect</h2>
          <p>
            Harmony collects operational analytics events that describe app behavior such as request status,
            latency, reconnects, and feature usage milestones.
          </p>
          <p>
            Harmony does not collect message content, email content, file payloads, raw SDP/ICE payloads, or
            media stream data inside analytics events.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Why We Collect It</h2>
          <p>
            Analytics is used to improve reliability, detect regressions, prioritize product work, and monitor
            moderation operations.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Retention</h2>
          <p>
            Analytics events are retained for up to 30 days and then deleted by automated cleanup jobs.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Data Minimization Rules</h2>
          <ul className="privacy-list">
            <li>Only allowlisted telemetry fields are accepted.</li>
            <li>Event payloads are limited to IDs, status codes, booleans, and aggregate timings.</li>
            <li>Non-allowlisted fields are dropped during ingestion.</li>
          </ul>
        </section>

        <section className="privacy-section">
          <h2>Your Controls</h2>
          <p>
            You can review this policy at any time from login/register pages and user settings. Operational
            account controls remain available through Harmony settings.
          </p>
        </section>

        <section className="privacy-section">
          <h2>Contact</h2>
          <p>
            For privacy questions, contact the Harmony administrators through your server support channel.
          </p>
        </section>

        <p className="auth-switch-copy">
          <Link to="/login">Back to login</Link>
        </p>
      </article>
    </main>
  );
}
