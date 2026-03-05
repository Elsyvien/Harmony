import { useMemo, useState } from 'react';
import type {
  AdminAnalyticsOverview,
  AdminAnalyticsTimeseries,
  AnalyticsCategory,
  AnalyticsWindow,
} from '../types/api';

type AdminAnalyticsPanelProps = {
  overview: AdminAnalyticsOverview | null;
  timeseries: AdminAnalyticsTimeseries | null;
  loading: boolean;
  error: string | null;
  onRefresh: (input: { window?: AnalyticsWindow; category?: AnalyticsCategory; name?: string }) => Promise<void>;
};

function formatMaybePercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'n/a';
  }
  return `${value.toFixed(2)}%`;
}

function formatMaybeNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toLocaleString();
}

export function AdminAnalyticsPanel(props: AdminAnalyticsPanelProps) {
  const [windowValue, setWindowValue] = useState<AnalyticsWindow>('24h');
  const [categoryValue, setCategoryValue] = useState<'ALL' | AnalyticsCategory>('ALL');
  const [nameValue, setNameValue] = useState('');

  const chartPoints = useMemo(() => {
    if (!props.timeseries?.points) {
      return [];
    }
    const maxTotal = Math.max(
      1,
      ...props.timeseries.points.map((point) => point.totalEvents),
    );
    return props.timeseries.points.map((point) => ({
      ...point,
      barHeightPercent: Math.max(4, Math.round((point.totalEvents / maxTotal) * 100)),
      label: new Date(point.bucketStart).toLocaleString([], {
        month: 'short',
        day: '2-digit',
        hour: props.timeseries?.interval === 'daily' ? undefined : '2-digit',
        minute: props.timeseries?.interval === 'daily' ? undefined : '2-digit',
      }),
    }));
  }, [props.timeseries]);

  const refresh = async () => {
    await props.onRefresh({
      window: windowValue,
      category: categoryValue === 'ALL' ? undefined : categoryValue,
      name: nameValue.trim() || undefined,
    });
  };

  return (
    <article className="setting-card">
      <div className="admin-header">
        <h3>Analytics</h3>
        <button className="ghost-btn" onClick={() => void refresh()} disabled={props.loading}>
          {props.loading ? 'Loading...' : 'Reload analytics'}
        </button>
      </div>

      <div className="admin-analytics-filters">
        <select
          value={windowValue}
          onChange={(event) => setWindowValue(event.target.value as AnalyticsWindow)}
          disabled={props.loading}
        >
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
        </select>
        <select
          value={categoryValue}
          onChange={(event) => setCategoryValue(event.target.value as 'ALL' | AnalyticsCategory)}
          disabled={props.loading}
        >
          <option value="ALL">All categories</option>
          <option value="reliability">Reliability</option>
          <option value="usage">Usage</option>
          <option value="moderation">Moderation</option>
          <option value="operations">Operations</option>
        </select>
        <input
          placeholder="Event name (optional)"
          value={nameValue}
          onChange={(event) => setNameValue(event.target.value)}
          disabled={props.loading}
        />
        <button className="ghost-btn" onClick={() => void refresh()} disabled={props.loading}>
          Apply
        </button>
      </div>

      {props.error ? <p className="error-banner">{props.error}</p> : null}
      {!props.overview ? <p className="muted-inline">No analytics data available yet.</p> : null}

      {props.overview ? (
        <>
          <div className="admin-user-stats">
            <span className="status-chip neutral">Events {props.overview.totals.events}</span>
            <span className="status-chip danger">Errors {props.overview.totals.errors}</span>
            <span className="status-chip neutral">Warnings {props.overview.totals.warnings}</span>
            <span className="status-chip neutral">Unique users {props.overview.totals.uniqueUsers}</span>
          </div>

          <div className="admin-stats-grid admin-analytics-grid">
            <article className="setting-card stat-card">
              <h3>Reliability</h3>
              <p className="stat-big">Error rate: {formatMaybePercent(props.overview.reliability.errorRatePercent)}</p>
              <p className="stat-big">P95 latency: {formatMaybeNumber(props.overview.reliability.p95LatencyMs)} ms</p>
              <p>Voice join success: {formatMaybePercent(props.overview.reliability.voiceJoinSuccessRatePercent)}</p>
              <p>Reconnect success: {formatMaybePercent(props.overview.reliability.wsReconnectSuccessRatePercent)}</p>
            </article>

            <article className="setting-card stat-card">
              <h3>Usage</h3>
              <p className="stat-big">DAU: {props.overview.usage.dau}</p>
              <p className="stat-big">WAU: {props.overview.usage.wau}</p>
              <p>Signup to first message: {formatMaybePercent(props.overview.usage.signupToFirstMessageRatePercent)}</p>
            </article>

            <article className="setting-card stat-card">
              <h3>Moderation</h3>
              <p className="stat-big">Actions: {props.overview.moderation.totalActions}</p>
              {props.overview.moderation.byEvent.length === 0 ? <p className="muted-inline">No moderation events.</p> : null}
              {props.overview.moderation.byEvent.slice(0, 4).map((item) => (
                <p key={item.name}>
                  <strong>{item.name}</strong>: {item.count}
                </p>
              ))}
            </article>

            <article className="setting-card stat-card">
              <h3>Operations</h3>
              <p className="stat-big">Events/min: {props.overview.operations.eventsPerMinute}</p>
              <p>Window: {props.overview.window}</p>
              <p>
                Range: {new Date(props.overview.range.start).toLocaleString()} -{' '}
                {new Date(props.overview.range.end).toLocaleString()}
              </p>
            </article>
          </div>
        </>
      ) : null}

      {props.timeseries ? (
        <div className="admin-analytics-series-wrap">
          <h4>Volume Trend ({props.timeseries.interval})</h4>
          <div className="admin-analytics-series">
            {chartPoints.map((point) => (
              <div key={point.bucketStart} className="admin-analytics-series-col">
                <div className="admin-analytics-series-bar-wrap">
                  <div
                    className="admin-analytics-series-bar"
                    style={{ height: `${point.barHeightPercent}%` }}
                    title={`${point.totalEvents} events`}
                  />
                </div>
                <small>{point.label}</small>
              </div>
            ))}
          </div>

          <div className="admin-analytics-lists">
            <div>
              <h4>Top events</h4>
              <ul className="admin-analytics-list">
                {props.timeseries.topEvents.slice(0, 8).map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    <strong>{item.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Top failures</h4>
              <ul className="admin-analytics-list">
                {props.timeseries.topFailures.slice(0, 8).map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    <strong>{item.count}</strong>
                  </li>
                ))}
                {props.timeseries.topFailures.length === 0 ? <li>No failures in selected window.</li> : null}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
