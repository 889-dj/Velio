import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import { ShareCanvas, ShareData, ShareOptions } from './ShareCanvas';
import { CANVAS, EXPORT, TOTAL_FRAMES, recorderAvailable } from '../lib/share';

export type StageHandle = {
  /** Renders every frame to an H.264 MP4 (development build only). Resolves to a file:// URI. */
  record: (onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<string>;
  /** A still image of the finished route card. Resolves to a file:// URI. */
  still: () => Promise<string>;
};

type StageProps = { data: ShareData; opts: ShareOptions; p: number };

/** Module is loaded lazily: importing it in Expo Go would reference a native view that does not exist. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rec: typeof import('react-native-view-recorder') | null = recorderAvailable() ? require('react-native-view-recorder') : null;

const cacheFile = (name: string) => {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  return f;
};
/** The recorder wants a plain absolute path, not a file:// URI. */
const toPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ''));

const finalFrame = TOTAL_FRAMES - 1;

/** Holds the frame being rendered and lets callers await the React commit for it. */
function useFrame() {
  const [frame, setFrame] = useState<number | null>(null);
  const waiter = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    waiter.current?.();
    waiter.current = null;
  }, [frame]);
  const show = (f: number | null) =>
    new Promise<void>((resolve) => {
      waiter.current = resolve;
      setFrame(f);
    });
  return { frame, show };
}

export const ShareStage = forwardRef<StageHandle, StageProps>(function ShareStage(props, ref) {
  return rec ? <NativeStage {...props} ref={ref} /> : <PlainStage {...props} ref={ref} />;
});

// ---------- development build: real MP4 export ----------
const NativeStage = forwardRef<StageHandle, StageProps>(function NativeStage({ data, opts, p }, ref) {
  const { RecordingView, useViewRecorder } = rec!;
  const recorder = useViewRecorder();
  const { frame, show } = useFrame();

  useImperativeHandle(ref, () => ({
    async record(onProgress, signal) {
      const out = cacheFile(`run-share-${Date.now()}.mp4`);
      try {
        await recorder.record({
          output: toPath(out.uri),
          fps: EXPORT.fps,
          totalFrames: TOTAL_FRAMES,
          width: EXPORT.w,
          height: EXPORT.h,
          codec: 'h264', // widest compatibility for Instagram, WhatsApp, iMessage
          quality: 0.9,
          signal,
          // draw frame i, wait for React to commit it, then the library captures it
          onFrame: async ({ frameIndex }) => {
            await show(frameIndex);
          },
          onProgress: ({ framesEncoded }) => onProgress(framesEncoded / TOTAL_FRAMES),
        });
      } finally {
        await show(null);
      }
      return out.uri;
    },
    async still() {
      const out = cacheFile(`run-share-${Date.now()}.png`);
      await show(finalFrame);
      try {
        await recorder.snapshot({ output: toPath(out.uri), format: 'png', width: EXPORT.w, height: EXPORT.h });
      } finally {
        await show(null);
      }
      return out.uri;
    },
  }));

  const pp = frame == null ? p : frame / finalFrame;
  return (
    <RecordingView sessionId={recorder.sessionId} style={{ width: CANVAS.w, height: CANVAS.h }}>
      <ShareCanvas data={data} opts={opts} p={pp} />
    </RecordingView>
  );
});

// ---------- Expo Go: still image only ----------
const PlainStage = forwardRef<StageHandle, StageProps>(function PlainStage({ data, opts, p }, ref) {
  const view = useRef<View>(null);
  const { frame, show } = useFrame();

  useImperativeHandle(ref, () => ({
    async record() {
      throw new Error('Video export needs a development build.');
    },
    async still() {
      await show(finalFrame);
      try {
        return await captureRef(view, { format: 'png', quality: 1, width: EXPORT.w, height: EXPORT.h, result: 'tmpfile' });
      } finally {
        await show(null);
      }
    },
  }));

  const pp = frame == null ? p : frame / finalFrame;
  return (
    <View ref={view} collapsable={false} style={{ width: CANVAS.w, height: CANVAS.h }}>
      <ShareCanvas data={data} opts={opts} p={pp} />
    </View>
  );
});
