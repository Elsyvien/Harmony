import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { UserPreferences } from '../../../types/preferences';
import { getErrorMessage } from '../../../utils/error-message';

type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

type UseVoiceTransportOptions = {
  preferences: UserPreferences;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  replaceAudioTrackAcrossPeers: (audioTrack: MediaStreamTrack) => Promise<void>;
};

export function useVoiceTransport({
  preferences,
  updatePreferences,
  setError,
  replaceAudioTrackAcrossPeers,
}: UseVoiceTransportOptions) {
  const [localAudioReady, setLocalAudioReady] = useState(false);
  const [isSelfMuted, setIsSelfMuted] = useState(false);
  const [isSelfDeafened, setIsSelfDeafened] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>('unknown');
  const [requestingMicrophonePermission, setRequestingMicrophonePermission] = useState(false);

  const muteStateBeforeDeafenRef = useRef<boolean | null>(null);
  const localVoiceStreamRef = useRef<MediaStream | null>(null);
  const localVoiceProcessedStreamRef = useRef<MediaStream | null>(null);
  const localVoiceGainNodeRef = useRef<GainNode | null>(null);
  const localVoiceGainContextRef = useRef<AudioContext | null>(null);
  const localVoiceInputDeviceIdRef = useRef<string | null>(null);
  const localVoiceAcquirePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localAnalyserContextRef = useRef<AudioContext | null>(null);
  const localAnalyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceInputGainRef = useRef(preferences.voiceInputGain);

  const applyLocalVoiceTrackState = useCallback(
    (stream: MediaStream | null) => {
      if (!stream) {
        return;
      }
      const shouldEnableMic = !isSelfMuted && !isSelfDeafened;
      for (const track of stream.getAudioTracks()) {
        track.enabled = shouldEnableMic;
      }
    },
    [isSelfMuted, isSelfDeafened],
  );

  const toggleSelfMute = useCallback(() => {
    if (isSelfDeafened) {
      return;
    }
    setIsSelfMuted((current) => !current);
  }, [isSelfDeafened]);

  const toggleSelfDeafen = useCallback(() => {
    if (!isSelfDeafened) {
      muteStateBeforeDeafenRef.current = isSelfMuted;
      setIsSelfMuted(true);
      setIsSelfDeafened(true);
      return;
    }
    const restoreMutedState = muteStateBeforeDeafenRef.current ?? false;
    setIsSelfDeafened(false);
    setIsSelfMuted(restoreMutedState);
    muteStateBeforeDeafenRef.current = null;
  }, [isSelfDeafened, isSelfMuted]);

  const resetLocalAnalyser = useCallback(() => {
    if (localAnalyserSourceRef.current) {
      localAnalyserSourceRef.current.disconnect();
      localAnalyserSourceRef.current = null;
    }
    localAnalyserRef.current = null;
    if (localAnalyserContextRef.current) {
      void localAnalyserContextRef.current.close();
      localAnalyserContextRef.current = null;
    }
  }, []);

  const initLocalAnalyser = useCallback((stream: MediaStream) => {
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    resetLocalAnalyser();
    const analyserContext = new AudioContextClass();
    if (analyserContext.state === 'suspended') {
      void analyserContext.resume().catch(() => {
        // Some browsers require an explicit user gesture to resume.
      });
    }
    const analyser = analyserContext.createAnalyser();
    analyser.fftSize = 1024;
    const source = analyserContext.createMediaStreamSource(stream);
    source.connect(analyser);
    localAnalyserContextRef.current = analyserContext;
    localAnalyserSourceRef.current = source;
    localAnalyserRef.current = analyser;
  }, [resetLocalAnalyser]);

  const refreshMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      return;
    }
    if (!navigator.permissions?.query) {
      setMicrophonePermission('unknown');
      return;
    }
    try {
      const result = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      setMicrophonePermission(result.state as MicrophonePermissionState);
    } catch {
      setMicrophonePermission('unknown');
    }
  }, []);

  const enumerateAudioInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([]);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setAudioInputDevices(inputs);
    } catch {
      setAudioInputDevices([]);
    }
  }, []);

  const requestMicrophoneStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice is not supported in this browser');
    }
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    let resolvedDeviceId = preferredDeviceId;
    const buildConstraints = (deviceId: string | null): MediaTrackConstraints => ({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildConstraints(preferredDeviceId),
        video: false,
      });
      return { stream, resolvedDeviceId };
    } catch (err) {
      if (!preferredDeviceId) {
        throw err;
      }
      updatePreferences({ voiceInputDeviceId: null });
      resolvedDeviceId = null;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildConstraints(null),
        video: false,
      });
      return { stream, resolvedDeviceId };
    }
  }, [preferences.voiceInputDeviceId, updatePreferences]);

  const getLocalVoiceStream = useCallback(async (forceRefresh = false) => {
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    const currentRawStream = localVoiceStreamRef.current;
    const currentRawTrack = currentRawStream?.getAudioTracks()[0] ?? null;
    const canReuseCurrentStream =
      !forceRefresh &&
      currentRawStream !== null &&
      currentRawTrack !== null &&
      currentRawTrack.readyState === 'live' &&
      localVoiceInputDeviceIdRef.current === preferredDeviceId;

    if (canReuseCurrentStream) {
      applyLocalVoiceTrackState(currentRawStream);
      return localVoiceProcessedStreamRef.current ?? currentRawStream;
    }

    if (localVoiceAcquirePromiseRef.current) {
      return localVoiceAcquirePromiseRef.current;
    }

    const acquirePromise = (async () => {
      const previousRawStream = localVoiceStreamRef.current;
      const { stream: rawStream, resolvedDeviceId } = await requestMicrophoneStream();
      const rawTrack = rawStream.getAudioTracks()[0] ?? null;
      if (!rawTrack) {
        for (const track of rawStream.getTracks()) {
          track.stop();
        }
        throw new Error('No microphone track available');
      }

      if (localVoiceGainNodeRef.current) {
        localVoiceGainNodeRef.current.disconnect();
        localVoiceGainNodeRef.current = null;
      }
      if (localVoiceGainContextRef.current) {
        void localVoiceGainContextRef.current.close();
        localVoiceGainContextRef.current = null;
      }
      localVoiceProcessedStreamRef.current = null;

      let processedStream = rawStream;
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const gainContext = new AudioContextClass();
          if (gainContext.state === 'suspended') {
            void gainContext.resume().catch(() => {
              // Some browsers require an explicit user gesture to resume.
            });
          }
          const source = gainContext.createMediaStreamSource(rawStream);
          const gainNode = gainContext.createGain();
          gainNode.gain.value = voiceInputGainRef.current / 100;
          const destination = gainContext.createMediaStreamDestination();
          source.connect(gainNode);
          gainNode.connect(destination);
          localVoiceGainContextRef.current = gainContext;
          localVoiceGainNodeRef.current = gainNode;
          localVoiceProcessedStreamRef.current = destination.stream;
          processedStream = destination.stream;
        }
      } catch {
        processedStream = rawStream;
      }

      const processedTrack = processedStream.getAudioTracks()[0] ?? rawTrack;
      localVoiceStreamRef.current = rawStream;
      localVoiceInputDeviceIdRef.current = resolvedDeviceId;

      await replaceAudioTrackAcrossPeers(processedTrack);

      if (previousRawStream && previousRawStream !== rawStream) {
        for (const track of previousRawStream.getTracks()) {
          track.stop();
        }
      }

      applyLocalVoiceTrackState(rawStream);
      initLocalAnalyser(rawStream);
      void refreshMicrophonePermission();
      void enumerateAudioInputDevices();
      setLocalAudioReady(true);
      return processedStream;
    })();

    localVoiceAcquirePromiseRef.current = acquirePromise;
    try {
      return await acquirePromise;
    } finally {
      if (localVoiceAcquirePromiseRef.current === acquirePromise) {
        localVoiceAcquirePromiseRef.current = null;
      }
    }
  }, [
    applyLocalVoiceTrackState,
    enumerateAudioInputDevices,
    initLocalAnalyser,
    preferences.voiceInputDeviceId,
    refreshMicrophonePermission,
    replaceAudioTrackAcrossPeers,
    requestMicrophoneStream,
  ]);

  const teardownLocalVoiceMedia = useCallback(() => {
    localVoiceAcquirePromiseRef.current = null;
    if (localVoiceStreamRef.current) {
      for (const track of localVoiceStreamRef.current.getTracks()) {
        track.stop();
      }
      localVoiceStreamRef.current = null;
      localVoiceInputDeviceIdRef.current = null;
    }
    if (localVoiceGainNodeRef.current) {
      localVoiceGainNodeRef.current.disconnect();
      localVoiceGainNodeRef.current = null;
    }
    if (localVoiceGainContextRef.current) {
      void localVoiceGainContextRef.current.close();
      localVoiceGainContextRef.current = null;
    }
    localVoiceProcessedStreamRef.current = null;
    resetLocalAnalyser();
    setLocalAudioReady(false);
  }, [resetLocalAnalyser]);

  const requestMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      return;
    }
    if (!window.isSecureContext) {
      setError('Microphone permission requires HTTPS (or localhost).');
      return;
    }
    setRequestingMicrophonePermission(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      await Promise.all([refreshMicrophonePermission(), enumerateAudioInputDevices()]);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Microphone permission was denied'));
      await refreshMicrophonePermission();
    } finally {
      setRequestingMicrophonePermission(false);
    }
  }, [enumerateAudioInputDevices, refreshMicrophonePermission, setError]);

  useEffect(() => {
    voiceInputGainRef.current = preferences.voiceInputGain;
    if (localVoiceGainNodeRef.current) {
      localVoiceGainNodeRef.current.gain.value = preferences.voiceInputGain / 100;
    }
  }, [preferences.voiceInputGain]);

  useEffect(() => {
    void refreshMicrophonePermission();
    void enumerateAudioInputDevices();
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }
    const handleDeviceChange = () => {
      void enumerateAudioInputDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshMicrophonePermission, enumerateAudioInputDevices]);

  useEffect(() => {
    if (!preferences.voiceInputDeviceId) {
      return;
    }
    if (audioInputDevices.length === 0) {
      return;
    }
    if (audioInputDevices.some((device) => device.deviceId === preferences.voiceInputDeviceId)) {
      return;
    }
    updatePreferences({ voiceInputDeviceId: null });
  }, [audioInputDevices, preferences.voiceInputDeviceId, updatePreferences]);

  useEffect(() => {
    return () => {
      teardownLocalVoiceMedia();
    };
  }, [teardownLocalVoiceMedia]);

  return {
    localAudioReady,
    isSelfMuted,
    isSelfDeafened,
    setIsSelfMuted,
    setIsSelfDeafened,
    localVoiceStreamRef,
    localAnalyserRef,
    audioInputDevices,
    microphonePermission,
    requestingMicrophonePermission,
    requestMicrophonePermission,
    applyLocalVoiceTrackState,
    toggleSelfMute,
    toggleSelfDeafen,
    getLocalVoiceStream,
    teardownLocalVoiceMedia,
  };
}
