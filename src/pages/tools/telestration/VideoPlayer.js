import React, { useEffect, useRef, useCallback } from 'react';

export default function VideoPlayer({ videoSource, videoController }) {
  const { videoRef, handleLoadedMetadata, handleEnded } = videoController;

  if (!videoSource) return null;

  if (videoSource.type === 'youtube') {
    return (
      <YouTubePlayer
        videoId={videoSource.videoId}
        videoController={videoController}
      />
    );
  }

  return (
    <video
      ref={videoRef}
      src={videoSource.url}
      preload="auto"
      onLoadedMetadata={handleLoadedMetadata}
      onEnded={handleEnded}
      style={styles.video}
    />
  );
}

// --- YouTube IFrame API player ---

function YouTubePlayer({ videoId, videoController }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);

  const {
    setYouTubePlayer,
    handleYouTubeReady,
    handleYouTubeStateChange,
  } = videoController;

  // Load YouTube IFrame API if not already loaded
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      initPlayer();
      return;
    }
    // Load the API script
    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    // Wait for API ready
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      initPlayer();
    };
    return () => {
      if (window.onYouTubeIframeAPIReady === initPlayer) {
        window.onYouTubeIframeAPIReady = prev || null;
      }
    };
  }, [videoId]); // eslint-disable-line

  const initPlayer = useCallback(() => {
    if (!containerRef.current || !window.YT?.Player) return;
    // Destroy existing player
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }

    const player = new window.YT.Player(containerRef.current, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (e) => {
          playerRef.current = e.target;
          if (setYouTubePlayer) setYouTubePlayer(e.target);
          if (handleYouTubeReady) handleYouTubeReady(e.target);
        },
        onStateChange: (e) => {
          if (handleYouTubeStateChange) handleYouTubeStateChange(e.data);
        },
      },
    });
  }, [videoId, setYouTubePlayer, handleYouTubeReady, handleYouTubeStateChange]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div style={styles.ytContainer}>
      <div ref={containerRef} style={styles.ytPlayer} />
    </div>
  );
}

const styles = {
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  ytContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytPlayer: {
    width: '100%',
    height: '100%',
  },
};
