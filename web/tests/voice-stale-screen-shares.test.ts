import { describe, expect, it } from 'vitest';
import {
  getStaleRemoteScreenShareUserIds,
  hasLiveVideoTrack,
} from '../src/pages/chat/utils/stale-screen-shares';

function createStream(trackState: MediaStreamTrackState): MediaStream {
  const track = { readyState: trackState } as MediaStreamTrack;
  return {
    getVideoTracks: () => [track],
  } as MediaStream;
}

function createConnection(
  state: RTCPeerConnectionState,
): RTCPeerConnection {
  return {
    connectionState: state,
  } as RTCPeerConnection;
}

describe('stale remote screen shares', () => {
  it('detects live video tracks', () => {
    expect(hasLiveVideoTrack(createStream('live'))).toBe(true);
    expect(hasLiveVideoTrack(createStream('ended'))).toBe(false);
  });

  it('returns stale users when source is missing, track ended, or peer is closed', () => {
    const remoteScreenShares: Record<string, MediaStream> = {
      keep: createStream('live'),
      missingSource: createStream('live'),
      endedTrack: createStream('ended'),
      closedPeer: createStream('live'),
    };
    const remoteVideoSourceByPeer = new Map<string, 'screen' | 'camera' | null>([
      ['keep', 'screen'],
      ['missingSource', null],
      ['endedTrack', 'camera'],
      ['closedPeer', 'screen'],
    ]);
    const peerConnectionsByUser = new Map<string, RTCPeerConnection>([
      ['keep', createConnection('connected')],
      ['missingSource', createConnection('connected')],
      ['endedTrack', createConnection('connected')],
      ['closedPeer', createConnection('closed')],
    ]);

    const stale = getStaleRemoteScreenShareUserIds({
      remoteScreenShares,
      remoteVideoSourceByPeer,
      peerConnectionsByUser,
    });

    expect(stale).toEqual(['missingSource', 'endedTrack', 'closedPeer']);
  });
});
