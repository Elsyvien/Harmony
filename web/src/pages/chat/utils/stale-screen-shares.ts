type StreamSource = 'screen' | 'camera' | null;

export function hasLiveVideoTrack(stream: MediaStream) {
  return stream.getVideoTracks().some((track) => track.readyState === 'live');
}

export function getStaleRemoteScreenShareUserIds(params: {
  remoteScreenShares: Record<string, MediaStream>;
  remoteVideoSourceByPeer: Map<string, StreamSource>;
  peerConnectionsByUser: Map<string, RTCPeerConnection>;
}) {
  const { remoteScreenShares, remoteVideoSourceByPeer, peerConnectionsByUser } = params;
  const staleUserIds: string[] = [];
  for (const [userId, stream] of Object.entries(remoteScreenShares)) {
    const source = remoteVideoSourceByPeer.get(userId) ?? null;
    const peerConnection = peerConnectionsByUser.get(userId);
    const isPeerClosed = !peerConnection || peerConnection.connectionState === 'closed';
    if (source === null || !hasLiveVideoTrack(stream) || isPeerClosed) {
      staleUserIds.push(userId);
    }
  }
  return staleUserIds;
}
