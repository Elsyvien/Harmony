import { useMemo, useState } from 'react';
import type { FriendRequestSummary, FriendSummary } from '../types/api';

type FriendsTab = 'friends' | 'incoming' | 'outgoing' | 'add';

interface FriendsPanelProps {
  friends: FriendSummary[];
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
  loading: boolean;
  error: string | null;
  actionBusyId: string | null;
  submittingRequest: boolean;
  onRefresh: () => Promise<void>;
  onSendRequest: (username: string) => Promise<void>;
  onAccept: (requestId: string) => Promise<void>;
  onDecline: (requestId: string) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
  onRemove: (friendshipId: string) => Promise<void>;
  onStartDm: (userId: string) => Promise<void>;
  openingDmUserId: string | null;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

export function FriendsPanel(props: FriendsPanelProps) {
  const [tab, setTab] = useState<FriendsTab>('friends');
  const [usernameInput, setUsernameInput] = useState('');
  const [search, setSearch] = useState('');

  const filteredFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return props.friends;
    }
    return props.friends.filter((friend) => friend.user.username.toLowerCase().includes(query));
  }, [props.friends, search]);

  const filteredIncoming = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return props.incoming;
    }
    return props.incoming.filter((item) => item.from.username.toLowerCase().includes(query));
  }, [props.incoming, search]);

  const filteredOutgoing = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return props.outgoing;
    }
    return props.outgoing.filter((item) => item.to.username.toLowerCase().includes(query));
  }, [props.outgoing, search]);

  return (
    <section className="settings-panel friends-panel">
      <div className="admin-header">
        <h2>Friends</h2>
        <button className="ghost-btn" onClick={() => void props.onRefresh()} disabled={props.loading}>
          {props.loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {props.error ? <p className="error-banner">{props.error}</p> : null}

      <div className="friends-tab-row">
        <button
          className={tab === 'friends' ? 'ghost-btn active-pill' : 'ghost-btn'}
          onClick={() => setTab('friends')}
        >
          Friends ({props.friends.length})
        </button>
        <button
          className={tab === 'incoming' ? 'ghost-btn active-pill' : 'ghost-btn'}
          onClick={() => setTab('incoming')}
        >
          Incoming ({props.incoming.length})
        </button>
        <button
          className={tab === 'outgoing' ? 'ghost-btn active-pill' : 'ghost-btn'}
          onClick={() => setTab('outgoing')}
        >
          Outgoing ({props.outgoing.length})
        </button>
        <button
          className={tab === 'add' ? 'ghost-btn active-pill' : 'ghost-btn'}
          onClick={() => setTab('add')}
        >
          Add Friend
        </button>
      </div>

      {tab === 'add' ? (
        <article className="setting-card">
          <h3>Add a Friend</h3>
          <p>Send a friend request by exact username.</p>
          <form
            className="friends-add-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const username = usernameInput.trim();
              if (!username || props.submittingRequest) {
                return;
              }
              await props.onSendRequest(username);
              setUsernameInput('');
              setTab('outgoing');
            }}
          >
            <input
              value={usernameInput}
              onChange={(event) => setUsernameInput(event.target.value)}
              placeholder="username"
              minLength={3}
              maxLength={24}
            />
            <button className="ghost-btn" type="submit" disabled={props.submittingRequest}>
              {props.submittingRequest ? 'Sending...' : 'Send request'}
            </button>
          </form>
        </article>
      ) : null}

      {tab !== 'add' ? (
        <div className="friends-search-row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users"
          />
        </div>
      ) : null}

      {tab === 'friends' ? (
        <div className="friends-list">
          {filteredFriends.map((friend) => {
            const busy = props.actionBusyId === friend.id;
            const openingDm = props.openingDmUserId === friend.user.id;
            return (
              <article key={friend.id} className="friend-card">
                <div>
                  <strong>{friend.user.username}</strong>
                  <small>Friends since {formatTime(friend.friendsSince)}</small>
                </div>
                <div className="friend-card-actions">
                  <button
                    className="ghost-btn"
                    disabled={openingDm}
                    onClick={() => void props.onStartDm(friend.user.id)}
                  >
                    {openingDm ? 'Opening...' : 'Start DM'}
                  </button>
                  <button
                    className="danger-btn"
                    disabled={busy}
                    onClick={() => void props.onRemove(friend.id)}
                  >
                    {busy ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </article>
            );
          })}
          {filteredFriends.length === 0 ? <p className="muted">No friends yet.</p> : null}
        </div>
      ) : null}

      {tab === 'incoming' ? (
        <div className="friends-list">
          {filteredIncoming.map((request) => {
            const busy = props.actionBusyId === request.id;
            return (
              <article key={request.id} className="friend-card">
                <div>
                  <strong>{request.from.username}</strong>
                  <small>Sent {formatTime(request.createdAt)}</small>
                </div>
                <div className="friend-card-actions">
                  <button className="ghost-btn" disabled={busy} onClick={() => void props.onAccept(request.id)}>
                    {busy ? 'Working...' : 'Accept'}
                  </button>
                  <button className="danger-btn" disabled={busy} onClick={() => void props.onDecline(request.id)}>
                    {busy ? 'Working...' : 'Decline'}
                  </button>
                </div>
              </article>
            );
          })}
          {filteredIncoming.length === 0 ? <p className="muted">No incoming requests.</p> : null}
        </div>
      ) : null}

      {tab === 'outgoing' ? (
        <div className="friends-list">
          {filteredOutgoing.map((request) => {
            const busy = props.actionBusyId === request.id;
            return (
              <article key={request.id} className="friend-card">
                <div>
                  <strong>{request.to.username}</strong>
                  <small>Sent {formatTime(request.createdAt)}</small>
                </div>
                <div className="friend-card-actions">
                  <button className="danger-btn" disabled={busy} onClick={() => void props.onCancel(request.id)}>
                    {busy ? 'Cancelling...' : 'Cancel request'}
                  </button>
                </div>
              </article>
            );
          })}
          {filteredOutgoing.length === 0 ? <p className="muted">No outgoing requests.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
