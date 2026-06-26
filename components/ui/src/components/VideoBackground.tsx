import { memo, useEffect, useRef, useState } from "react";

function VideoBackgroundComponent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadVideo, setLoadVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoSrc = `${import.meta.env.BASE_URL}back.mp4`;

  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => {
      const id = window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 250);
      return id as unknown as number;
    });
    const cancelIdle = window.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id));
    const idleId = scheduleIdle(() => setLoadVideo(true), { timeout: 900 });
    return () => cancelIdle(idleId);
  }, []);

  useEffect(() => {
    if (!loadVideo) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.playbackRate = 0.72;
  }, [loadVideo]);

  function tryPlayVideo() {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    try {
      const playback = video.play();
      if (playback && typeof playback.catch === "function") {
        void playback.catch(() => {
          setVideoReady(false);
        });
      }
    } catch {
      setVideoReady(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(145deg,#080a10_0%,#111521_48%,#06070b_100%)]" />
      {loadVideo ? (
        <video
          autoPlay
          className={[
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
            videoReady ? "opacity-75" : "opacity-0",
          ].join(" ")}
          loop
          muted
          onCanPlay={() => {
            setVideoReady(true);
            tryPlayVideo();
          }}
          onError={() => setVideoReady(false)}
          playsInline
          preload="metadata"
          ref={videoRef}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,12,0.42),rgba(6,8,12,0.18)_30%,rgba(6,8,12,0.62))]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

export const VideoBackground = memo(VideoBackgroundComponent);
