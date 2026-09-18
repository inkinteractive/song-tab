/**
 * Capture.
 *
 * Two legitimate paths, as the brief requires:
 *   - microphone (the student plays or the phone speaker is pointed at the mic)
 *   - browser tab / system audio via getDisplayMedia
 *
 * DRM-protected audio from the Spotify or Apple Music *apps* cannot be captured
 * by a browser at all - that is not a gap in this code, it is how the platform
 * works. Tab capture works for the web players when the browser allows it.
 */

export type CaptureSource = 'mic' | 'tab';

export interface CaptureSession {
  source: CaptureSource;
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  stop(): void;
}

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * True when the app is running inside an iframe.
 *
 * Capture is gated by the *embedding page's* permissions policy, not just by
 * the viewer's own permission. A frame that does not carry `allow="microphone"`
 * gets a NotAllowedError that no amount of clicking the address bar will fix,
 * so the two cases need different advice.
 */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access, which is itself the answer.
    return true;
  }
}

/**
 * Whether the embedding page has granted us the capture feature at all.
 * `featurePolicy` is Chromium-only, so an unknown answer is reported as such
 * rather than guessed.
 */
function policyAllows(feature: 'microphone' | 'display-capture'): boolean | null {
  const fp = (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  if (!fp?.allowsFeature) return null;
  try {
    return fp.allowsFeature(feature);
  } catch {
    return null;
  }
}

/**
 * Whether live capture is blocked by the page embedding us.
 *
 * A same-origin frame inherits the policy and works normally, so being framed
 * is not on its own a problem - it is the combination of being framed and the
 * feature not being granted. When `featurePolicy` is unavailable the answer is
 * unknown, and for a framed page unknown is treated as blocked: warning the
 * teacher costs nothing, letting them click a dead button costs a lesson.
 */
export function captureBlockedByEmbedder(source: CaptureSource = 'mic'): boolean {
  if (!isEmbedded()) return false;
  return policyAllows(source === 'mic' ? 'microphone' : 'display-capture') !== true;
}

/** Raw, unprocessed mic audio. Browser voice processing wrecks music. */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export async function startCapture(source: CaptureSource): Promise<CaptureSession> {
  let stream: MediaStream;
  try {
    if (source === 'mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new CaptureError('Microphone capture is not available', 'This browser does not expose getUserMedia. Chrome, Edge or Firefox over https (or localhost) will work.');
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
    } else {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new CaptureError('Tab audio capture is not available', 'getDisplayMedia is missing. Chrome or Edge on desktop supports sharing a tab with its audio.');
      }
      // Chrome only offers the "share tab audio" checkbox when video is requested too.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints,
      });
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        throw new CaptureError(
          'That share had no audio',
          'Pick a browser tab and tick "Share tab audio" (or "Share system audio"). Sharing a window or a whole screen usually cannot carry sound.',
        );
      }
      // We only ever wanted the sound.
      stream.getVideoTracks().forEach((t) => t.stop());
    }
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError') {
      if (captureBlockedByEmbedder(source)) {
        throw new CaptureError(
          'This page cannot reach your ' + (source === 'mic' ? 'microphone' : 'screen or tabs'),
          'The app is running inside an embedded frame that does not allow capture, so there is no permission for you to grant here. ' +
            'Open the app in its own browser tab, or run it locally, and capture will work. You can still import an audio file below.',
        );
      }
      throw new CaptureError(
        'Permission denied',
        'The browser blocked the capture. Allow it in the address-bar permissions and try again.',
      );
    }
    if (name === 'NotFoundError') {
      throw new CaptureError('No input device found', 'No microphone is connected, or the browser cannot see one.');
    }
    throw new CaptureError('Could not start capture', err instanceof Error ? err.message : String(err));
  }

  const context = new AudioContext();
  const sourceNode = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  sourceNode.connect(analyser);
  // Deliberately not connected to the destination: monitoring a mic through the
  // speakers in a lesson room is instant feedback.

  return {
    source,
    stream,
    context,
    analyser,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      sourceNode.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}

export interface Recorder {
  stop(): Promise<Blob>;
  mimeType: string;
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

export function startRecording(stream: MediaStream): Recorder {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
      });
    },
  };
}

/** Decode any captured or imported audio into an AudioBuffer. */
export async function decodeToBuffer(data: Blob | ArrayBuffer): Promise<AudioBuffer> {
  const arrayBuffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
