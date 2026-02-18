import { useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { VoiceStatePayload } from '../../../hooks/use-chat-socket';
import { trackTelemetryError } from '../../../utils/telemetry';
import {
  isVoiceSignalData,
  shouldInitiateOffer,
  type VoiceSignalData,
} from '../utils/voice-signaling';

type StreamSource = 'screen' | 'camera';

type UseVoiceSignalingOptions = {
  authUser: { id: string } | null;  activeVoiceChannelIdRef: RefObject<string | null>;
  voiceBusyChannelIdRef: RefObject<string | null>;
  voiceBusyChannelId: string | null;
  playVoiceStateSound: (kind: 'join' | 'leave') => void;
  closePeerConnection: (peerUserId: string) => void;
  ensurePeerConnection: (peerUserId: string, channelId: string) => Promise<RTCPeerConnection>;
  flushPendingIceCandidates: (peerUserId: string, connection: RTCPeerConnection) => Promise<void>;
  createOfferForPeer: (peerUserId: string, channelId: string) => Promise<void>;
  sendVoiceSignal: (channelId: string, targetUserId: string, data: VoiceSignalData) => boolean;
  peerConnectionsRef: RefObject<Map<string, RTCPeerConnection>>;
  pendingIceRef: RefObject<Map<string, RTCIceCandidateInit[]>>;
  pendingVideoRenegotiationByPeerRef: RefObject<Set<string>>;
  remoteVideoSourceByPeerRef: RefObject<Map<string, StreamSource | null>>;
  remoteVideoStreamByPeerRef: RefObject<Map<string, MediaStream>>;
  setRemoteAdvertisedVideoSourceByPeer: Dispatch<
    SetStateAction<Record<string, StreamSource | null>>
  >;
  setRemoteScreenShares: Dispatch<SetStateAction<Record<string, MediaStream>>>;
  setVoiceParticipantsByChannel: Dispatch<SetStateAction<Record<string, VoiceStatePayload['participants']>>>;
  setActiveVoiceChannelId: Dispatch<SetStateAction<string | null>>;
  setVoiceBusyChannelId: Dispatch<SetStateAction<string | null>>;
  logVoiceDebug: (event: string, details?: Record<string, unknown>) => void;
};

export function useVoiceSignaling({
  authUser,  activeVoiceChannelIdRef,
  voiceBusyChannelIdRef,
  voiceBusyChannelId,
  playVoiceStateSound,
  closePeerConnection,
  ensurePeerConnection,
  flushPendingIceCandidates,
  createOfferForPeer,
  sendVoiceSignal,
  peerConnectionsRef,
  pendingIceRef,
  pendingVideoRenegotiationByPeerRef,
  remoteVideoSourceByPeerRef,
  remoteVideoStreamByPeerRef,
  setRemoteAdvertisedVideoSourceByPeer,
  setRemoteScreenShares,
  setVoiceParticipantsByChannel,
  setActiveVoiceChannelId,
  setVoiceBusyChannelId,
  logVoiceDebug,
}: UseVoiceSignalingOptions) {
  const queuedVoiceSignalsRef = useRef<Array<{ channelId: string; fromUserId: string; data: VoiceSignalData }>>([]);
  const drainingVoiceSignalsRef = useRef(false);
  const voiceParticipantIdsByChannelRef = useRef<Map<string, Set<string>>>(new Map());

  const canProcessVoiceSignalsForChannel = useCallback((channelId: string) => {
    const activeVoiceChannelId = activeVoiceChannelIdRef.current;
    const busyVoiceChannelId = voiceBusyChannelIdRef.current;
    return activeVoiceChannelId === channelId || busyVoiceChannelId === channelId;
  }, [activeVoiceChannelIdRef, voiceBusyChannelIdRef]);

  const processVoiceSignal = useCallback(
    async (payload: { channelId: string; fromUserId: string; data: VoiceSignalData }) => {
      if (!authUser || payload.fromUserId === authUser.id) {
        return;
      }

      const signal = payload.data;
      if (signal.kind === 'video-source') {
        remoteVideoSourceByPeerRef.current.set(payload.fromUserId, signal.source);
        setRemoteAdvertisedVideoSourceByPeer((prev) => ({
          ...prev,
          [payload.fromUserId]: signal.source,
        }));
        if (signal.source === 'screen' || signal.source === 'camera') {
          const stream = remoteVideoStreamByPeerRef.current.get(payload.fromUserId);
          if (stream) {
            setRemoteScreenShares((prev) => ({
              ...prev,
              [payload.fromUserId]: stream,
            }));
          }
        } else {
          setRemoteScreenShares((prev) => {
            if (!prev[payload.fromUserId]) {
              return prev;
            }
            const next = { ...prev };
            delete next[payload.fromUserId];
            return next;
          });
        }
        return;
      }

      if (signal.kind === 'renegotiate') {
        const localUserId = authUser.id;
        if (!shouldInitiateOffer(localUserId, payload.fromUserId)) {
          return;
        }
        closePeerConnection(payload.fromUserId);
        try {
          await ensurePeerConnection(payload.fromUserId, payload.channelId);
          await createOfferForPeer(payload.fromUserId, payload.channelId);
        } catch {
          // Best effort. Next sync cycle can recover.
        }
        return;
      }

      if (signal.kind === 'request-offer') {
        // Soft renegotiation: the non-offerer has replaced a track and asks the
        // offerer to issue a new offer so SDP reflects the change — no teardown.
        const localUserId = authUser.id;
        if (!shouldInitiateOffer(localUserId, payload.fromUserId)) {
          return;
        }
        try {
          await createOfferForPeer(payload.fromUserId, payload.channelId);
        } catch {
          // Best effort.
        }
        return;
      }

      if (signal.kind === 'ice') {
        const connection = peerConnectionsRef.current.get(payload.fromUserId);
        if (!connection || !connection.remoteDescription) {
          const queue = pendingIceRef.current.get(payload.fromUserId) ?? [];
          queue.push(signal.candidate);
          pendingIceRef.current.set(payload.fromUserId, queue);
          return;
        }
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch {
          // Ignore invalid/stale ICE candidates.
        }
        return;
      }

      const connection = await ensurePeerConnection(payload.fromUserId, payload.channelId);
      const localUserId = authUser.id;

      if (signal.kind === 'offer') {
        if (shouldInitiateOffer(localUserId, payload.fromUserId)) {
          // Deterministic initiator should not receive offers in steady state.
          return;
        }

        if (connection.signalingState === 'have-local-offer') {
          try {
            await connection.setLocalDescription({ type: 'rollback' });
          } catch {
            pendingVideoRenegotiationByPeerRef.current.add(payload.fromUserId);
            return;
          }
        } else if (connection.signalingState !== 'stable') {
          return;
        }

        try {
          await connection.setRemoteDescription(signal.sdp);
        } catch (err) {
          trackTelemetryError('voice_signal_offer_remote_description_failed', err, {
            peerUserId: payload.fromUserId,
            channelId: payload.channelId,
            signalingState: connection.signalingState,
          });
          closePeerConnection(payload.fromUserId);
          try {
            await ensurePeerConnection(payload.fromUserId, payload.channelId);
            await createOfferForPeer(payload.fromUserId, payload.channelId);
          } catch {
            // Best effort. Next voice sync can recover.
          }
          return;
        }
        await flushPendingIceCandidates(payload.fromUserId, connection);
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendVoiceSignal(payload.channelId, payload.fromUserId, {
          kind: 'answer',
          sdp: answer,
        } satisfies VoiceSignalData);
        return;
      }

      if (!shouldInitiateOffer(localUserId, payload.fromUserId)) {
        return;
      }

      if (connection.signalingState !== 'have-local-offer') {
        return;
      }

      try {
        await connection.setRemoteDescription(signal.sdp);
      } catch (err) {
        trackTelemetryError('voice_signal_answer_remote_description_failed', err, {
          peerUserId: payload.fromUserId,
          channelId: payload.channelId,
          signalingState: connection.signalingState,
        });
        closePeerConnection(payload.fromUserId);
        try {
          await ensurePeerConnection(payload.fromUserId, payload.channelId);
          await createOfferForPeer(payload.fromUserId, payload.channelId);
        } catch {
          // Best effort. Next voice sync can recover.
        }
        return;
      }
      await flushPendingIceCandidates(payload.fromUserId, connection);
    },
    [
      authUser,
      closePeerConnection,
      createOfferForPeer,
      ensurePeerConnection,
      flushPendingIceCandidates,
      peerConnectionsRef,
      pendingIceRef,
      pendingVideoRenegotiationByPeerRef,
      remoteVideoSourceByPeerRef,
      remoteVideoStreamByPeerRef,
      sendVoiceSignal,
      setRemoteAdvertisedVideoSourceByPeer,
      setRemoteScreenShares,
    ],
  );

  const drainQueuedVoiceSignals = useCallback(async () => {
    if (drainingVoiceSignalsRef.current || !authUser) {
      return;
    }
    drainingVoiceSignalsRef.current = true;
    try {
      let loopGuard = 0;
      while (queuedVoiceSignalsRef.current.length > 0 && loopGuard < 400) {
        loopGuard += 1;
        const pending = queuedVoiceSignalsRef.current;
        queuedVoiceSignalsRef.current = [];
        const deferred: Array<{ channelId: string; fromUserId: string; data: VoiceSignalData }> = [];

        for (const signal of pending) {
          if (!canProcessVoiceSignalsForChannel(signal.channelId)) {
            deferred.push(signal);
            continue;
          }
          await processVoiceSignal(signal);
        }

        if (deferred.length > 0) {
          queuedVoiceSignalsRef.current = deferred;
          break;
        }
      }
    } finally {
      drainingVoiceSignalsRef.current = false;
    }
  }, [authUser, canProcessVoiceSignalsForChannel, processVoiceSignal]);

  const handleVoiceSignal = useCallback(
    async (payload: { channelId: string; fromUserId: string; data: unknown }) => {
      if (!authUser || payload.fromUserId === authUser.id) {
        return;
      }
      if (!isVoiceSignalData(payload.data)) {
        return;
      }

      const normalizedPayload = {
        channelId: payload.channelId,
        fromUserId: payload.fromUserId,
        data: payload.data,
      };

      if (!canProcessVoiceSignalsForChannel(payload.channelId)) {
        const queue = queuedVoiceSignalsRef.current;
        queue.push(normalizedPayload);
        logVoiceDebug('voice_signal_queued', {
          fromUserId: payload.fromUserId,
          channelId: payload.channelId,
          kind: payload.data.kind,
          queueSize: queue.length,
        });
        if (queue.length > 300) {
          queue.splice(0, queue.length - 300);
        }
        return;
      }

      logVoiceDebug('voice_signal_process', {
        fromUserId: payload.fromUserId,
        channelId: payload.channelId,
        kind: payload.data.kind,
      });
      await processVoiceSignal(normalizedPayload);
      await drainQueuedVoiceSignals();
    },
    [authUser, canProcessVoiceSignalsForChannel, drainQueuedVoiceSignals, logVoiceDebug, processVoiceSignal],
  );

  const handleVoiceState = useCallback(
    (payload: VoiceStatePayload) => {
      const nextParticipantIds = new Set(payload.participants.map((participant) => participant.userId));
      const hadPreviousState = voiceParticipantIdsByChannelRef.current.has(payload.channelId);
      const previousParticipantIds = voiceParticipantIdsByChannelRef.current.get(payload.channelId) ?? new Set<string>();
      const isCurrentVoiceChannel = activeVoiceChannelIdRef.current === payload.channelId;
      if (authUser && hadPreviousState && isCurrentVoiceChannel) {
        const selfUserId = authUser.id;
        const someoneElseJoined = [...nextParticipantIds].some(
          (participantId) =>
            participantId !== selfUserId && !previousParticipantIds.has(participantId),
        );
        const someoneElseLeft = [...previousParticipantIds].some(
          (participantId) =>
            participantId !== selfUserId && !nextParticipantIds.has(participantId),
        );

        if (someoneElseJoined) {
          playVoiceStateSound('join');
        }
        if (someoneElseLeft) {
          playVoiceStateSound('leave');
        }
      }
      voiceParticipantIdsByChannelRef.current.set(payload.channelId, nextParticipantIds);

      setVoiceParticipantsByChannel((prev) => ({
        ...prev,
        [payload.channelId]: payload.participants,
      }));

      if (!authUser) {
        return;
      }

      const selfPresent = payload.participants.some((participant) => participant.userId === authUser.id);
      if (selfPresent) {
        activeVoiceChannelIdRef.current = payload.channelId;
        setActiveVoiceChannelId(payload.channelId);
        setVoiceBusyChannelId((current) => (current === payload.channelId ? null : current));
        return;
      }

      setActiveVoiceChannelId((current) => {
        if (current !== payload.channelId) {
          return current;
        }
        if (voiceBusyChannelId === payload.channelId) {
          return current;
        }
        activeVoiceChannelIdRef.current = null;
        return null;
      });
      if (voiceBusyChannelId !== payload.channelId) {
        setVoiceBusyChannelId((current) => (current === payload.channelId ? null : current));
      }
    },
    [
      authUser,
      activeVoiceChannelIdRef,
      playVoiceStateSound,
      setActiveVoiceChannelId,
      setVoiceBusyChannelId,
      setVoiceParticipantsByChannel,
      voiceBusyChannelId,
    ],
  );

  const resetVoiceSignalingState = useCallback(() => {
    voiceParticipantIdsByChannelRef.current.clear();
    queuedVoiceSignalsRef.current = [];
    drainingVoiceSignalsRef.current = false;
  }, []);


  return {
    handleVoiceSignal,
    handleVoiceState,
    resetVoiceSignalingState,
    voiceParticipantIdsByChannelRef,
  };
}

