import { useEffect, useRef, useState } from "react";

export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const videoSrc = `${import.meta.env.BASE_URL}back.mp4`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.playbackRate = 0.72;
  }, []);

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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,205,118,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(123,191,255,0.14),transparent_24%),linear-gradient(145deg,#090b12_0%,#111521_42%,#06070b_100%)]" />
      <video
        autoPlay
        className={[
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
          videoReady ? "opacity-82" : "opacity-0",
        ].join(" ")}
        loop
        muted
        onCanPlay={() => {
          setVideoReady(true);
          tryPlayVideo();
        }}
        onError={() => setVideoReady(false)}
        playsInline
        preload="auto"
        ref={videoRef}
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,12,0.32),rgba(6,8,12,0.16)_28%,rgba(6,8,12,0.58)),radial-gradient(circle_at_top_left,rgba(255,202,112,0.1),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_32%)]" />
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
