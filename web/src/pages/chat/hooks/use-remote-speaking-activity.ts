import { useCallback, useEffect, useRef } from 'react';

const REMOTE_SPEAKING_HOLD_MS = 350;
const REMOTE_SPEAKING_THRESHOLD_FLOOR = 0.008;
const SPEAKING_DETECTION_INTERVAL_MS = 50;

type RemoteAudioUser = {
  userId: string;
  stream: MediaStream;
};

type UseRemoteSpeakingActivityOptions = {
  enabled: boolean;
  sensitivity: number;
  currentUserId?: string;
  remoteAudioUsers: RemoteAudioUser[];
  setSpeakingUserIds: React.Dispatch<React.SetStateAction<string[]>>;
};

export function computeTimeDomainRms(data: ArrayLike<number>) {
  if (data.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const normalized = (data[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

export function getRemoteSpeakingThreshold(sensitivity: number) {
  if (!Number.isFinite(sensitivity)) {
    return REMOTE_SPEAKING_THRESHOLD_FLOOR;
  }
  return Math.max(REMOTE_SPEAKING_THRESHOLD_FLOOR, sensitivity * 0.75);
}

export function mergeSpeakingUserIds(
  previous: string[],
  currentUserId: string | undefined,
  remoteOrder: string[],
  remoteSpeakingSet: Set<string>,
) {
  const selfList = currentUserId ? previous.filter((id) => id === currentUserId) : [];
  const next = [...selfList, ...remoteOrder.filter((userId) => remoteSpeakingSet.has(userId))];
  if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
    return previous;
  }
  return next;
}

function resolveAudioContextClass() {
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

export function useRemoteSpeakingActivity({
  enabled,
  sensitivity,
  currentUserId,
  remoteAudioUsers,
  setSpeakingUserIds,
}: UseRemoteSpeakingActivityOptions) {
  const remoteSpeakingContextRef = useRef<AudioContext | null>(null);
  const remoteSpeakingSourceByUserRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const remoteSpeakingAnalyserByUserRef = useRef<Map<string, AnalyserNode>>(new Map());
  const remoteSpeakingDataByUserRef = useRef<Map<string, Uint8Array>>(new Map());
  const remoteSpeakingLastSpokeAtByUserRef = useRef<Map<string, number>>(new Map());
  const remoteSpeakingStreamByUserRef = useRef<Map<string, MediaStream>>(new Map());

  const disconnectRemoteSpeakingForUser = useCallback((userId: string) => {
    const source = remoteSpeakingSourceByUserRef.current.get(userId);
    try {
      source?.disconnect();
    } catch {
      // Ignore teardown errors caused by already-disposed nodes.
    }
    remoteSpeakingSourceByUserRef.current.delete(userId);
    remoteSpeakingAnalyserByUserRef.current.delete(userId);
    remoteSpeakingDataByUserRef.current.delete(userId);
    remoteSpeakingLastSpokeAtByUserRef.current.delete(userId);
    remoteSpeakingStreamByUserRef.current.delete(userId);
  }, []);

  const disconnectAllRemoteSpeaking = useCallback(() => {
    for (const userId of Array.from(remoteSpeakingSourceByUserRef.current.keys())) {
      disconnectRemoteSpeakingForUser(userId);
    }
  }, [disconnectRemoteSpeakingForUser]);

  const ensureRemoteSpeakingContext = useCallback(() => {
    if (remoteSpeakingContextRef.current && remoteSpeakingContextRef.current.state !== 'closed') {
      return remoteSpeakingContextRef.current;
    }
    const AudioContextClass = resolveAudioContextClass();
    if (!AudioContextClass) {
      return null;
    }
    const context = new AudioContextClass();
    remoteSpeakingContextRef.current = context;
    return context;
  }, []);

  useEffect(() => {
    return () => {
      disconnectAllRemoteSpeaking();
      const context = remoteSpeakingContextRef.current;
      remoteSpeakingContextRef.current = null;
      if (context && context.state !== 'closed') {
        void context.close().catch(() => {
          // Ignore close errors during unmount.
        });
      }
    };
  }, [disconnectAllRemoteSpeaking]);

  useEffect(() => {
    if (!enabled) {
      disconnectAllRemoteSpeaking();
      setSpeakingUserIds((prev) => (currentUserId ? prev.filter((id) => id === currentUserId) : []));
      return;
    }

    const context = ensureRemoteSpeakingContext();
    if (!context) {
      return;
    }
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        // Best effort. A user gesture may be required in some browsers.
      });
    }

    const activeRemoteUserIds = new Set(remoteAudioUsers.map((user) => user.userId));
    for (const { userId, stream } of remoteAudioUsers) {
      const existingStream = remoteSpeakingStreamByUserRef.current.get(userId);
      if (existingStream === stream) {
        continue;
      }
      disconnectRemoteSpeakingForUser(userId);
      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.35;
        source.connect(analyser);
        remoteSpeakingSourceByUserRef.current.set(userId, source);
        remoteSpeakingAnalyserByUserRef.current.set(userId, analyser);
        remoteSpeakingDataByUserRef.current.set(userId, new Uint8Array(analyser.fftSize));
        remoteSpeakingStreamByUserRef.current.set(userId, stream);
      } catch {
        // Some streams can be transient; retry on the next pass.
      }
    }
    for (const userId of Array.from(remoteSpeakingSourceByUserRef.current.keys())) {
      if (!activeRemoteUserIds.has(userId)) {
        disconnectRemoteSpeakingForUser(userId);
      }
    }

    const speakingThreshold = getRemoteSpeakingThreshold(sensitivity);
    const remoteOrder = remoteAudioUsers.map((user) => user.userId);
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const remoteSpeakingSet = new Set<string>();

      for (const userId of remoteOrder) {
        const analyser = remoteSpeakingAnalyserByUserRef.current.get(userId);
        const data = remoteSpeakingDataByUserRef.current.get(userId);
        if (!analyser || !data) {
          continue;
        }
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        const rms = computeTimeDomainRms(data);
        if (rms >= speakingThreshold) {
          remoteSpeakingLastSpokeAtByUserRef.current.set(userId, now);
          remoteSpeakingSet.add(userId);
          continue;
        }
        const lastSpokeAt = remoteSpeakingLastSpokeAtByUserRef.current.get(userId) ?? 0;
        if (now - lastSpokeAt <= REMOTE_SPEAKING_HOLD_MS) {
          remoteSpeakingSet.add(userId);
        }
      }

      setSpeakingUserIds((prev) =>
        mergeSpeakingUserIds(prev, currentUserId, remoteOrder, remoteSpeakingSet),
      );
    }, SPEAKING_DETECTION_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    enabled,
    sensitivity,
    currentUserId,
    remoteAudioUsers,
    setSpeakingUserIds,
    disconnectAllRemoteSpeaking,
    disconnectRemoteSpeakingForUser,
    ensureRemoteSpeakingContext,
  ]);
}
