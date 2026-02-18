export const DEFAULT_STREAM_QUALITY = '720p 30fps';

const STREAM_QUALITY_CONSTRAINTS: Record<string, { width: number; height: number; frameRate: number }> = {
  '360p 15fps': { width: 640, height: 360, frameRate: 15 },
  '360p 30fps': { width: 640, height: 360, frameRate: 30 },
  '480p 15fps': { width: 854, height: 480, frameRate: 15 },
  '480p 30fps': { width: 854, height: 480, frameRate: 30 },
  '720p 15fps': { width: 1280, height: 720, frameRate: 15 },
  '720p 30fps': { width: 1280, height: 720, frameRate: 30 },
  '720p 60fps': { width: 1280, height: 720, frameRate: 60 },
  '900p 30fps': { width: 1600, height: 900, frameRate: 30 },
  '1080p 30fps': { width: 1920, height: 1080, frameRate: 30 },
  '1080p 60fps': { width: 1920, height: 1080, frameRate: 60 },
  '1440p 30fps': { width: 2560, height: 1440, frameRate: 30 },
  '1440p 60fps': { width: 2560, height: 1440, frameRate: 60 },
  '2160p 30fps': { width: 3840, height: 2160, frameRate: 30 },
};

const CAMERA_MAX_CAPTURE_CONSTRAINTS = {
  width: 1920,
  height: 1080,
  frameRate: 30,
} as const;

const CAMERA_FALLBACK_QUALITY_LABELS = [
  '1080p 30fps',
  '720p 30fps',
  '720p 15fps',
  '480p 30fps',
  '480p 15fps',
  '360p 30fps',
  '360p 15fps',
] as const;

export type StreamQualityPreset = { width: number; height: number; frameRate: number };

export function isValidStreamQualityLabel(label: string) {
  return Boolean(STREAM_QUALITY_CONSTRAINTS[label]);
}

export function getStreamQualityPreset(label: string): StreamQualityPreset {
  return STREAM_QUALITY_CONSTRAINTS[label] ?? STREAM_QUALITY_CONSTRAINTS[DEFAULT_STREAM_QUALITY];
}

export function toVideoTrackConstraints(preset: StreamQualityPreset): MediaTrackConstraints {
  return {
    width: { ideal: preset.width, max: preset.width },
    height: { ideal: preset.height, max: preset.height },
    frameRate: { ideal: preset.frameRate, max: preset.frameRate },
  };
}

export function clampCameraPreset(preset: StreamQualityPreset): StreamQualityPreset {
  return {
    width: Math.min(preset.width, CAMERA_MAX_CAPTURE_CONSTRAINTS.width),
    height: Math.min(preset.height, CAMERA_MAX_CAPTURE_CONSTRAINTS.height),
    frameRate: Math.min(preset.frameRate, CAMERA_MAX_CAPTURE_CONSTRAINTS.frameRate),
  };
}

export function getCameraCapturePresetLabels(preferredLabel: string): string[] {
  const labels = [preferredLabel, ...CAMERA_FALLBACK_QUALITY_LABELS, DEFAULT_STREAM_QUALITY];
  return [...new Set(labels.filter((label) => Boolean(STREAM_QUALITY_CONSTRAINTS[label])))];
}
