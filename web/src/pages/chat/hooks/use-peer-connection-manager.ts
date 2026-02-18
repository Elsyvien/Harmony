import { useCallback, useEffect, useRef } from 'react';

import { shouldInitiateOffer, type VoiceSignalData } from '../utils/voice-signaling';

type StreamSource = 'screen' | 'camera';

type UsePeerConnectionManagerOptions = {
  authUserId: string | null;
  activeVoiceBitrateKbps: number;
  activeStreamBitrateKbps: number;
  voiceIceConfig: RTCConfiguration;
  hasTurnRelayConfigured: boolean;
  localStreamSource: StreamSource | null;
  localScreenStreamRef: React.RefObject<MediaStream | null>;
  activeVoiceChannelIdRef: React.RefObject<string | null>;
  getLocalVoiceStream: () => Promise<MediaStream>;
  sendVoiceSignal: (channelId: string, targetUserId: string, data: VoiceSignalData) => boolean;
  onRemoteAudioStream: (peerUserId: string, stream: MediaStream | null) => void;
  onRemoteScreenShareStream: (peerUserId: string, stream: MediaStream | null) => void;
  onRemoteAdvertisedVideoSource: (peerUserId: string, source: StreamSource | null) => void;
  onDisconnectRemoteAudio: (peerUserId: string) => void;
  onConnectionFailureWithoutTurn: () => void;
  logVoiceDebug: (event: string, details?: Record<string, unknown>) => void;
};

export function usePeerConnectionManager({
  authUserId,
  activeVoiceBitrateKbps,
  activeStreamBitrateKbps,
  voiceIceConfig,
  hasTurnRelayConfigured,
  localStreamSource,
  localScreenStreamRef,
  activeVoiceChannelIdRef,
  getLocalVoiceStream,
  sendVoiceSignal,
  onRemoteAudioStream,
  onRemoteScreenShareStream,
  onRemoteAdvertisedVideoSource,
  onDisconnectRemoteAudio,
  onConnectionFailureWithoutTurn,
  logVoiceDebug,
}: UsePeerConnectionManagerOptions) {
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const videoSenderByPeerRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const pendingVideoRenegotiationByPeerRef = useRef<Set<string>>(new Set());
  const makingOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferByPeerRef = useRef<Map<string, boolean>>(new Map());
  const remoteVideoSourceByPeerRef = useRef<Map<string, StreamSource | null>>(new Map());
  const remoteVideoStreamByPeerRef = useRef<Map<string, MediaStream>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const disconnectTimeoutByPeerRef = useRef<Map<string, number>>(new Map());
  const createOfferForPeerRef = useRef((() => Promise.resolve()) as (peerUserId: string, channelId: string) => Promise<void>);

  const applyAudioBitrateToConnection = useCallback(
    async (connection: RTCPeerConnection, bitrateKbps: number) => {
      const bitrateBps = Math.max(8, bitrateKbps) * 1000;
      for (const sender of connection.getSenders()) {
        if (!sender.track || sender.track.kind !== 'audio') {
          continue;
        }
        try {
          const parameters = sender.getParameters();
          const existingEncodings =
            parameters.encodings && parameters.encodings.length > 0
              ? parameters.encodings
              : [{}];
          parameters.encodings = existingEncodings.map((encoding) => ({
            ...encoding,
            maxBitrate: bitrateBps,
          }));
          await sender.setParameters(parameters);
        } catch {
          // Browser may not allow dynamic sender parameter updates.
        }
      }
    },
    [],
  );

  const applyVideoBitrateToConnection = useCallback(
    async (connection: RTCPeerConnection, bitrateKbps: number) => {
      const bitrateBps = Math.max(128, bitrateKbps) * 1000;
      for (const sender of connection.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') {
          continue;
        }
        try {
          const parameters = sender.getParameters();
          const existingEncodings =
            parameters.encodings && parameters.encodings.length > 0
              ? parameters.encodings
              : [{}];
          parameters.encodings = existingEncodings.map((encoding) => ({
            ...encoding,
            maxBitrate: bitrateBps,
          }));
          await sender.setParameters(parameters);
        } catch {
          // Browser may not allow dynamic sender parameter updates.
        }
      }
    },
    [],
  );

  const getOrCreateVideoSender = useCallback((connection: RTCPeerConnection) => {
    const fromVideoTransceiver = connection
      .getTransceivers()
      .find((transceiver) => transceiver.receiver.track?.kind === 'video')
      ?.sender;
    if (fromVideoTransceiver) {
      return fromVideoTransceiver;
    }

    const existingVideoSender =
      connection.getSenders().find((candidate) => candidate.track?.kind === 'video') ?? null;
    if (existingVideoSender) {
      return existingVideoSender;
    }

    return connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
  }, []);

  const flushPendingIceCandidates = useCallback(async (peerUserId: string, connection: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerUserId);
    if (!queued?.length || !connection.remoteDescription) {
      return;
    }
    pendingIceRef.current.delete(peerUserId);
    for (const candidate of queued) {
      try {
        await connection.addIceCandidate(candidate);
      } catch {
        // Ignore invalid/stale ICE candidates.
      }
    }
  }, []);

  const closePeerConnection = useCallback(
    (peerUserId: string) => {
      const disconnectTimeout = disconnectTimeoutByPeerRef.current.get(peerUserId);
      if (disconnectTimeout) {
        window.clearTimeout(disconnectTimeout);
        disconnectTimeoutByPeerRef.current.delete(peerUserId);
      }
      const connection = peerConnectionsRef.current.get(peerUserId);
      if (connection) {
        connection.onicecandidate = null;
        connection.ontrack = null;
        connection.onsignalingstatechange = null;
        connection.onconnectionstatechange = null;
        connection.close();
        peerConnectionsRef.current.delete(peerUserId);
      }
      videoSenderByPeerRef.current.delete(peerUserId);
      pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
      makingOfferByPeerRef.current.delete(peerUserId);
      ignoreOfferByPeerRef.current.delete(peerUserId);
      remoteVideoSourceByPeerRef.current.delete(peerUserId);
      onRemoteAdvertisedVideoSource(peerUserId, null);
      remoteVideoStreamByPeerRef.current.delete(peerUserId);
      pendingIceRef.current.delete(peerUserId);
      onDisconnectRemoteAudio(peerUserId);
      onRemoteAudioStream(peerUserId, null);
      onRemoteScreenShareStream(peerUserId, null);
    },
    [
      onDisconnectRemoteAudio,
      onRemoteAdvertisedVideoSource,
      onRemoteAudioStream,
      onRemoteScreenShareStream,
    ],
  );

  const ensurePeerConnection = useCallback(
    async (peerUserId: string, channelId: string) => {
      const existing = peerConnectionsRef.current.get(peerUserId);
      if (existing) {
        logVoiceDebug('peer_connection_reuse', { peerUserId, channelId });
        return existing;
      }

      const stream = await getLocalVoiceStream();
      const connection = new RTCPeerConnection({
        ...voiceIceConfig,
      });
      logVoiceDebug('peer_connection_create', {
        peerUserId,
        channelId,
        hasTurnRelayConfigured,
        iceTransportPolicy: voiceIceConfig.iceTransportPolicy ?? 'all',
      });

      for (const track of stream.getTracks()) {
        connection.addTrack(track, stream);
      }
      const videoSender = getOrCreateVideoSender(connection);
      videoSenderByPeerRef.current.set(peerUserId, videoSender);
      const localVideoTrack = localScreenStreamRef.current?.getVideoTracks()[0] ?? null;
      if (localVideoTrack) {
        try {
          await videoSender.replaceTrack(localVideoTrack);
        } catch {
          // Keep empty sender and continue. Next renegotiation can recover.
        }
      }
      await applyAudioBitrateToConnection(connection, activeVoiceBitrateKbps);
      await applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        sendVoiceSignal(channelId, peerUserId, {
          kind: 'ice',
          candidate: event.candidate.toJSON(),
        } satisfies VoiceSignalData);
      };

      sendVoiceSignal(channelId, peerUserId, {
        kind: 'video-source',
        source: localStreamSource,
      } satisfies VoiceSignalData);

      connection.ontrack = (event) => {
        const streamFromTrack = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === 'audio') {
          onRemoteAudioStream(peerUserId, streamFromTrack);
        } else if (event.track.kind === 'video') {
          remoteVideoStreamByPeerRef.current.set(peerUserId, streamFromTrack);
          const setRemoteVideoVisible = () => {
            const currentSource = remoteVideoSourceByPeerRef.current.get(peerUserId) ?? null;
            if (currentSource === null) {
              return;
            }
            onRemoteScreenShareStream(peerUserId, streamFromTrack);
          };
          const clearRemoteVideo = () => {
            onRemoteScreenShareStream(peerUserId, null);
          };
          setRemoteVideoVisible();
          event.track.onmute = clearRemoteVideo;
          event.track.onunmute = setRemoteVideoVisible;
          event.track.onended = () => {
            remoteVideoStreamByPeerRef.current.delete(peerUserId);
            clearRemoteVideo();
          };
        }
      };

      connection.onsignalingstatechange = () => {
        if (connection.signalingState !== 'stable') {
          return;
        }
        if (!pendingVideoRenegotiationByPeerRef.current.has(peerUserId)) {
          return;
        }
        const activeChannelId = activeVoiceChannelIdRef.current;
        if (!activeChannelId) {
          pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
          return;
        }
        pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
        void createOfferForPeerRef.current(peerUserId, activeChannelId);
      };

      connection.onconnectionstatechange = () => {
        const existingDisconnectTimeout = disconnectTimeoutByPeerRef.current.get(peerUserId);
        if (existingDisconnectTimeout && connection.connectionState !== 'disconnected') {
          window.clearTimeout(existingDisconnectTimeout);
          disconnectTimeoutByPeerRef.current.delete(peerUserId);
        }
        logVoiceDebug('peer_connection_state', {
          peerUserId,
          channelId,
          connectionState: connection.connectionState,
          iceConnectionState: connection.iceConnectionState,
          signalingState: connection.signalingState,
        });
        if (connection.connectionState === 'closed') {
          closePeerConnection(peerUserId);
          return;
        }
        if (connection.connectionState === 'failed') {
          if (!hasTurnRelayConfigured) {
            onConnectionFailureWithoutTurn();
          }
          const activeChannelId = activeVoiceChannelIdRef.current;
          if (activeChannelId) {
            sendVoiceSignal(activeChannelId, peerUserId, { kind: 'renegotiate' } satisfies VoiceSignalData);
          }
          closePeerConnection(peerUserId);
          if (activeChannelId) {
            void createOfferForPeerRef.current(peerUserId, activeChannelId);
          }
          return;
        }

        if (connection.connectionState === 'disconnected') {
          if (disconnectTimeoutByPeerRef.current.has(peerUserId)) {
            return;
          }
          const timeoutId = window.setTimeout(() => {
            disconnectTimeoutByPeerRef.current.delete(peerUserId);
            const activeChannelId = activeVoiceChannelIdRef.current;
            if (!activeChannelId) {
              closePeerConnection(peerUserId);
              return;
            }
            sendVoiceSignal(activeChannelId, peerUserId, { kind: 'renegotiate' } satisfies VoiceSignalData);
            closePeerConnection(peerUserId);
            void createOfferForPeerRef.current(peerUserId, activeChannelId);
          }, 3500);
          disconnectTimeoutByPeerRef.current.set(peerUserId, timeoutId);
        }
      };

      peerConnectionsRef.current.set(peerUserId, connection);
      return connection;
    },
    [
      activeStreamBitrateKbps,
      activeVoiceBitrateKbps,
      applyAudioBitrateToConnection,
      applyVideoBitrateToConnection,
      closePeerConnection,
      getLocalVoiceStream,
      getOrCreateVideoSender,
      hasTurnRelayConfigured,
      localScreenStreamRef,
      localStreamSource,
      logVoiceDebug,
      onConnectionFailureWithoutTurn,
      onRemoteAudioStream,
      onRemoteScreenShareStream,
      sendVoiceSignal,
      voiceIceConfig,
      activeVoiceChannelIdRef,
    ],
  );

  const createOfferForPeer = useCallback(
    async (peerUserId: string, channelId: string) => {
      if (!authUserId) {
        return;
      }
      if (!shouldInitiateOffer(authUserId, peerUserId)) {
        sendVoiceSignal(channelId, peerUserId, { kind: 'renegotiate' } satisfies VoiceSignalData);
        return;
      }
      const connection = await ensurePeerConnection(peerUserId, channelId);
      if (makingOfferByPeerRef.current.get(peerUserId)) {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
        return;
      }
      if (connection.signalingState !== 'stable') {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
        return;
      }
      pendingVideoRenegotiationByPeerRef.current.delete(peerUserId);
      makingOfferByPeerRef.current.set(peerUserId, true);
      try {
        const offer = await connection.createOffer();
        if (connection.signalingState !== 'stable') {
          pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
          return;
        }
        await connection.setLocalDescription(offer);
        const localDescription = connection.localDescription;
        if (!localDescription || localDescription.type !== 'offer') {
          pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
          return;
        }
        sendVoiceSignal(channelId, peerUserId, {
          kind: 'offer',
          sdp: localDescription,
        } satisfies VoiceSignalData);
      } catch {
        pendingVideoRenegotiationByPeerRef.current.add(peerUserId);
      } finally {
        makingOfferByPeerRef.current.delete(peerUserId);
      }
    },
    [authUserId, ensurePeerConnection, sendVoiceSignal],
  );

  const replaceAudioTrackAcrossPeers = useCallback(async (audioTrack: MediaStreamTrack) => {
    for (const connection of peerConnectionsRef.current.values()) {
      for (const sender of connection.getSenders()) {
        if (sender.track?.kind !== 'audio') {
          continue;
        }
        try {
          await sender.replaceTrack(audioTrack);
        } catch {
          // Ignore replacement errors; next renegotiation can recover.
        }
      }
    }
  }, []);

  const clearPeerConnections = useCallback(() => {
    for (const peerUserId of peerConnectionsRef.current.keys()) {
      closePeerConnection(peerUserId);
    }
    peerConnectionsRef.current.clear();
    videoSenderByPeerRef.current.clear();
    pendingVideoRenegotiationByPeerRef.current.clear();
    makingOfferByPeerRef.current.clear();
    ignoreOfferByPeerRef.current.clear();
    remoteVideoSourceByPeerRef.current.clear();
    remoteVideoStreamByPeerRef.current.clear();
    pendingIceRef.current.clear();
    for (const timeoutId of disconnectTimeoutByPeerRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    disconnectTimeoutByPeerRef.current.clear();
  }, [closePeerConnection]);

  const applyAudioBitrateToAllConnections = useCallback(() => {
    for (const connection of peerConnectionsRef.current.values()) {
      void applyAudioBitrateToConnection(connection, activeVoiceBitrateKbps);
    }
  }, [activeVoiceBitrateKbps, applyAudioBitrateToConnection]);

  const applyVideoBitrateToAllConnections = useCallback(() => {
    for (const connection of peerConnectionsRef.current.values()) {
      void applyVideoBitrateToConnection(connection, activeStreamBitrateKbps);
    }
  }, [activeStreamBitrateKbps, applyVideoBitrateToConnection]);

  useEffect(() => {
    createOfferForPeerRef.current = createOfferForPeer;
  }, [createOfferForPeer]);

  return {
    peerConnectionsRef,
    videoSenderByPeerRef,
    pendingVideoRenegotiationByPeerRef,
    remoteVideoSourceByPeerRef,
    remoteVideoStreamByPeerRef,
    pendingIceRef,
    flushPendingIceCandidates,
    closePeerConnection,
    ensurePeerConnection,
    createOfferForPeer,
    replaceAudioTrackAcrossPeers,
    applyAudioBitrateToConnection,
    applyVideoBitrateToConnection,
    applyAudioBitrateToAllConnections,
    applyVideoBitrateToAllConnections,
    getOrCreateVideoSender,
    clearPeerConnections,
  };
}

