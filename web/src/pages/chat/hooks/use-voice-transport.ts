import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  RnnoiseWorkletNode,
  SpeexWorkletNode,
  loadRnnoise,
  loadSpeex,
} from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import speexWorkletPath from '@sapphi-red/web-noise-suppressor/speexWorklet.js?url';
import speexWasmPath from '@sapphi-red/web-noise-suppressor/speex.wasm?url';

import type { UserPreferences } from '../../../types/preferences';
import { getErrorMessage } from '../../../utils/error-message';
import { trackTelemetryError } from '../../../utils/telemetry';

type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

type UseVoiceTransportOptions = {
  preferences: UserPreferences;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  replaceAudioTrackAcrossPeers: (audioTrack: MediaStreamTrack) => Promise<void>;
};

type VoiceSuppressorNode = AudioWorkletNode & {
  destroy?: () => void;
};

const ADVANCED_NOISE_SUPPRESSION_FALLBACK_NOTICE =
  'Advanced noise suppression is unavailable. Falling back to standard microphone processing.';

function buildVoiceProcessingConfigKey(preferences: UserPreferences, voiceInputDeviceId: string | null) {
  return JSON.stringify({
    voiceInputDeviceId,
    voiceNoiseSuppression: preferences.voiceNoiseSuppression,
    voiceEchoCancellation: preferences.voiceEchoCancellation,
    voiceAutoGainControl: preferences.voiceAutoGainControl,
  });
}

function buildCaptureConstraints(
  preferences: UserPreferences,
  voiceInputDeviceId: string | null,
): MediaTrackConstraints {
  return {
    echoCancellation: preferences.voiceEchoCancellation,
    noiseSuppression: preferences.voiceNoiseSuppression,
    autoGainControl: preferences.voiceAutoGainControl,
    ...(voiceInputDeviceId ? { deviceId: { exact: voiceInputDeviceId } } : {}),
  };
}

export function useVoiceTransport({
  preferences,
  updatePreferences,
  setError,
  setNotice,
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
  const localVoiceSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const localVoiceSuppressorNodeRef = useRef<VoiceSuppressorNode | null>(null);
  const localVoiceGainContextRef = useRef<AudioContext | null>(null);
  const localVoiceInputDeviceIdRef = useRef<string | null>(null);
  const localVoiceProcessingConfigRef = useRef<string | null>(null);
  const localVoiceAcquirePromiseRef = useRef<Promise<MediaStream> | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const localAnalyserContextRef = useRef<AudioContext | null>(null);
  const localAnalyserSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceInputGainRef = useRef(preferences.voiceInputGain);
  const rnnoiseWasmBinaryRef = useRef<ArrayBuffer | null>(null);
  const speexWasmBinaryRef = useRef<ArrayBuffer | null>(null);
  const suppressionFallbackNoticeShownRef = useRef(false);

  const applyLocalVoiceTrackState = useCallback(
    (stream: MediaStream | null) => {
      const shouldEnableMic = !isSelfMuted && !isSelfDeafened;
      const applyToStream = (targetStream: MediaStream | null) => {
        if (!targetStream) {
          return;
        }
        for (const track of targetStream.getAudioTracks()) {
          track.enabled = shouldEnableMic;
        }
      };
      applyToStream(stream);
      if (localVoiceProcessedStreamRef.current !== stream) {
        applyToStream(localVoiceProcessedStreamRef.current);
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

  const initLocalAnalyser = useCallback(
    (stream: MediaStream) => {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
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
    },
    [resetLocalAnalyser],
  );

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

  const notifyAdvancedNoiseSuppressionFallback = useCallback(
    (error: unknown, stage: 'rnnoise' | 'speex' | 'general') => {
      trackTelemetryError('voice_noise_suppression_fallback', error, {
        stage,
      });
      if (suppressionFallbackNoticeShownRef.current) {
        return;
      }
      suppressionFallbackNoticeShownRef.current = true;
      setNotice(ADVANCED_NOISE_SUPPRESSION_FALLBACK_NOTICE);
    },
    [setNotice],
  );

  const createAdvancedSuppressorNode = useCallback(
    async (audioContext: AudioContext): Promise<VoiceSuppressorNode> => {
      if (!audioContext.audioWorklet) {
        throw new Error('AudioWorklet is not supported');
      }

      try {
        await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
        if (!rnnoiseWasmBinaryRef.current) {
          rnnoiseWasmBinaryRef.current = await loadRnnoise({
            url: rnnoiseWasmPath,
            simdUrl: rnnoiseSimdWasmPath,
          });
        }
        return new RnnoiseWorkletNode(audioContext, {
          maxChannels: 1,
          wasmBinary: rnnoiseWasmBinaryRef.current.slice(0),
        });
      } catch (rnnoiseError) {
        notifyAdvancedNoiseSuppressionFallback(rnnoiseError, 'rnnoise');
      }

      try {
        await audioContext.audioWorklet.addModule(speexWorkletPath);
        if (!speexWasmBinaryRef.current) {
          speexWasmBinaryRef.current = await loadSpeex({ url: speexWasmPath });
        }
        return new SpeexWorkletNode(audioContext, {
          maxChannels: 1,
          wasmBinary: speexWasmBinaryRef.current.slice(0),
        });
      } catch (speexError) {
        notifyAdvancedNoiseSuppressionFallback(speexError, 'speex');
        throw speexError;
      }
    },
    [notifyAdvancedNoiseSuppressionFallback],
  );

  const requestMicrophoneStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Voice is not supported in this browser');
    }
    const preferredDeviceId = preferences.voiceInputDeviceId || null;
    let resolvedDeviceId = preferredDeviceId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildCaptureConstraints(preferences, preferredDeviceId),
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
        audio: buildCaptureConstraints(preferences, null),
        video: false,
      });
      return { stream, resolvedDeviceId };
    }
  }, [
    preferences,
    preferences.voiceInputDeviceId,
    preferences.voiceEchoCancellation,
    preferences.voiceNoiseSuppression,
    preferences.voiceAutoGainControl,
    updatePreferences,
  ]);

  const disposeLocalVoiceProcessing = useCallback(() => {
    const processedStream = localVoiceProcessedStreamRef.current;
    localVoiceProcessedStreamRef.current = null;

    if (localVoiceSourceNodeRef.current) {
      localVoiceSourceNodeRef.current.disconnect();
      localVoiceSourceNodeRef.current = null;
    }

    if (localVoiceSuppressorNodeRef.current) {
      localVoiceSuppressorNodeRef.current.disconnect();
      localVoiceSuppressorNodeRef.current.destroy?.();
      localVoiceSuppressorNodeRef.current = null;
    }

    if (localVoiceGainNodeRef.current) {
      localVoiceGainNodeRef.current.disconnect();
      localVoiceGainNodeRef.current = null;
    }
    if (localVoiceGainContextRef.current) {
      void localVoiceGainContextRef.current.close();
      localVoiceGainContextRef.current = null;
    }

    if (processedStream) {
      for (const track of processedStream.getTracks()) {
        track.stop();
      }
    }
  }, []);

  const resolveOutboundVoiceStream = useCallback(
    async (rawStream: MediaStream, rawTrack: MediaStreamTrack) => {
      const processedStream = localVoiceProcessedStreamRef.current;
      if (!processedStream) {
        return { stream: rawStream, track: rawTrack };
      }

      let processedTrack = processedStream.getAudioTracks()[0] ?? null;
      if (!processedTrack || processedTrack.readyState !== 'live') {
        disposeLocalVoiceProcessing();
        return { stream: rawStream, track: rawTrack };
      }

      const gainContext = localVoiceGainContextRef.current;
      if (gainContext && gainContext.state !== 'running') {
        try {
          if (gainContext.state !== 'closed') {
            await gainContext.resume();
          }
        } catch {
          // Resume may require a user gesture; the raw track is still usable.
        }

        processedTrack = processedStream.getAudioTracks()[0] ?? null;
        const gainContextRunning = localVoiceGainContextRef.current?.state === 'running';
        if (!gainContextRunning || !processedTrack || processedTrack.readyState !== 'live') {
          disposeLocalVoiceProcessing();
          return { stream: rawStream, track: rawTrack };
        }
      }

      return { stream: processedStream, track: processedTrack };
    },
    [disposeLocalVoiceProcessing],
  );

  const getLocalVoiceStream = useCallback(
    async (forceRefresh = false) => {
      const preferredDeviceId = preferences.voiceInputDeviceId || null;
      const desiredConfig = buildVoiceProcessingConfigKey(preferences, preferredDeviceId);
      const currentRawStream = localVoiceStreamRef.current;
      const currentRawTrack = currentRawStream?.getAudioTracks()[0] ?? null;
      const canReuseCurrentStream =
        !forceRefresh &&
        currentRawStream !== null &&
        currentRawTrack !== null &&
        currentRawTrack.readyState === 'live' &&
        localVoiceInputDeviceIdRef.current === preferredDeviceId &&
        localVoiceProcessingConfigRef.current === desiredConfig;

      if (canReuseCurrentStream) {
        const hadProcessedStream = localVoiceProcessedStreamRef.current !== null;
        const { stream: outboundStream, track: outboundTrack } = await resolveOutboundVoiceStream(
          currentRawStream,
          currentRawTrack,
        );
        applyLocalVoiceTrackState(currentRawStream);
        if (hadProcessedStream && outboundTrack === currentRawTrack) {
          await replaceAudioTrackAcrossPeers(currentRawTrack);
        }
        return outboundStream;
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

        disposeLocalVoiceProcessing();

        try {
          const AudioContextClass =
            window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (AudioContextClass) {
            const gainContext = new AudioContextClass();
            if (gainContext.state === 'suspended') {
              void gainContext.resume().catch(() => {
                // Some browsers require an explicit user gesture to resume.
              });
            }

            const source = gainContext.createMediaStreamSource(rawStream);
            let processingNode: AudioNode = source;

            if (preferences.voiceNoiseSuppression) {
              try {
                const suppressorNode = await createAdvancedSuppressorNode(gainContext);
                source.connect(suppressorNode);
                processingNode = suppressorNode;
                localVoiceSuppressorNodeRef.current = suppressorNode;
              } catch (error) {
                notifyAdvancedNoiseSuppressionFallback(error, 'general');
                localVoiceSuppressorNodeRef.current = null;
              }
            }

            const gainNode = gainContext.createGain();
            gainNode.gain.value = voiceInputGainRef.current / 100;
            const destination = gainContext.createMediaStreamDestination();

            processingNode.connect(gainNode);
            gainNode.connect(destination);

            localVoiceGainContextRef.current = gainContext;
            localVoiceSourceNodeRef.current = source;
            localVoiceGainNodeRef.current = gainNode;
            localVoiceProcessedStreamRef.current = destination.stream;
          }
        } catch (error) {
          trackTelemetryError('voice_audio_processing_init_failed', error);
          // Fall back to the raw stream when Web Audio processing cannot be created.
        }

        const { stream: outboundStream, track: outboundTrack } = await resolveOutboundVoiceStream(
          rawStream,
          rawTrack,
        );
        localVoiceStreamRef.current = rawStream;
        localVoiceInputDeviceIdRef.current = resolvedDeviceId;
        localVoiceProcessingConfigRef.current = desiredConfig;

        await replaceAudioTrackAcrossPeers(outboundTrack);

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
        return outboundStream;
      })();

      localVoiceAcquirePromiseRef.current = acquirePromise;
      try {
        return await acquirePromise;
      } finally {
        if (localVoiceAcquirePromiseRef.current === acquirePromise) {
          localVoiceAcquirePromiseRef.current = null;
        }
      }
    },
    [
      applyLocalVoiceTrackState,
      createAdvancedSuppressorNode,
      disposeLocalVoiceProcessing,
      enumerateAudioInputDevices,
      initLocalAnalyser,
      notifyAdvancedNoiseSuppressionFallback,
      preferences,
      preferences.voiceAutoGainControl,
      preferences.voiceEchoCancellation,
      preferences.voiceInputDeviceId,
      preferences.voiceNoiseSuppression,
      refreshMicrophonePermission,
      replaceAudioTrackAcrossPeers,
      requestMicrophoneStream,
      resolveOutboundVoiceStream,
    ],
  );

  const teardownLocalVoiceMedia = useCallback(() => {
    localVoiceAcquirePromiseRef.current = null;
    if (localVoiceStreamRef.current) {
      for (const track of localVoiceStreamRef.current.getTracks()) {
        track.stop();
      }
      localVoiceStreamRef.current = null;
      localVoiceInputDeviceIdRef.current = null;
      localVoiceProcessingConfigRef.current = null;
    }
    disposeLocalVoiceProcessing();
    resetLocalAnalyser();
    setLocalAudioReady(false);
  }, [disposeLocalVoiceProcessing, resetLocalAnalyser]);

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
    localVoiceProcessedStreamRef,
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
