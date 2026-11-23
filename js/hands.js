// Camera and hand tracking. MediaPipe runs entirely in the browser; video never leaves the device.

const MP_VERSION = '1.2.3';
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = null; // 'user' | 'environment'
    this.landmarker = null;
    this.loading = null;
    this.lastTime = -1;
  }

  get on() { return !!this.stream; }
  get mirrored() { return this.facing === 'user'; }

  static async hasBackCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      if (cams.some((d) => /back|rear|environment/i.test(d.label))) return true;
      return cams.length > 1;
    } catch {
      return false;
    }
  }

  async start(facing) {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    this.stop();
    const want = { facingMode: facing === 'environment' ? { exact: 'environment' } : 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: want, audio: false });
    } catch (err) {
      if (facing === 'environment' && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } else {
        throw err;
      }
    }
    this.stream = stream;
    this.facing = facing;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) {
      await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastTime = -1;
  }

  async loadModel() {
    if (this.landmarker) return this.landmarker;
    if (!this.loading) {
      this.loading = (async () => {
        const vision = await import(MP_BUNDLE);
        const files = await vision.FilesetResolver.forVisionTasks(MP_WASM);
        const opts = (delegate) => ({
          baseOptions: { modelAssetPath: HAND_MODEL, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        try {
          return await vision.HandLandmarker.createFromOptions(files, opts('GPU'));
        } catch {
          return await vision.HandLandmarker.createFromOptions(files, opts('CPU'));
        }
      })();
    }
    try {
      this.landmarker = await this.loading;
    } catch (err) {
      this.loading = null;
      throw err;
    }
    return this.landmarker;
  }

  // Returns raw landmarks for a new video frame, or null if there's no new frame.
  detect(now) {
    const v = this.video;
    if (!this.on || !this.landmarker || v.readyState < 2 || v.currentTime === this.lastTime) return null;
    this.lastTime = v.currentTime;
    try {
      const r = this.landmarker.detectForVideo(v, now);
      return (r.landmarks || []).map((lms, h) => ({ key: r.handedness?.[h]?.[0]?.categoryName || `h${h}`, lms }));
    } catch {
      return null;
    }
  }
}
