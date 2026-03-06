import { Link } from 'react-router-dom';

const POLICY_VERSION = '2026-03-05';

export function PrivacyPage() {
  return (
    <main className="auth-page privacy-page">
      <article className="auth-card privacy-card">
        <header className="privacy-hero">
          <div>
            <p className="privacy-kicker">Privacy</p>
            <h1>Operational data only, never your message content.</h1>
            <p className="auth-subtitle">Version {POLICY_VERSION}</p>
          </div>
          <div className="privacy-summary-card">
            <strong>At a glance</strong>
            <ul className="privacy-list compact">
              <li>Telemetry is limited to product behavior and reliability signals.</li>
              <li>Message bodies, files, and raw media payloads are excluded.</li>
              <li>Retention is capped at 30 days.</li>
            </ul>
          </div>
        </header>

        <div className="privacy-layout">
          <aside className="privacy-aside">
            <div className="privacy-aside-card">
              <strong>Need something specific?</strong>
              <p>
                This page is meant to be readable before login, so it focuses on what Harmony stores,
                why it exists, and how long it sticks around.
              </p>
              <p className="auth-switch-copy">
                <Link to="/login">Back to login</Link>
              </p>
            </div>
          </aside>

          <div className="privacy-content">
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
          </div>
        </div>
      </article>
    </main>
  );
}
