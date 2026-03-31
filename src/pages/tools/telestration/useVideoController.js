import { useState, useRef, useCallback, useEffect } from 'react';
import { FRAME_DURATION } from './telestrationConstants';

export default function useVideoController() {
  const videoRef = useRef(null);       // HTML5 video element
  const ytPlayerRef = useRef(null);    // YouTube IFrame API player instance
  const rafRef = useRef(null);
  const ytIntervalRef = useRef(null);

  const [isYouTube, setIsYouTube] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });

  // ─── HTML5 Video ──────────────────────────────────────────────

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (video && !video.paused) {
      setCurrentTime(video.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  const play = useCallback(() => {
    if (isYouTube) {
      const yt = ytPlayerRef.current;
      if (!yt) return;
      yt.playVideo();
      setIsPlaying(true);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.play();
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [isYouTube, tick]);

  const pause = useCallback(() => {
    if (isYouTube) {
      const yt = ytPlayerRef.current;
      if (!yt) return;
      yt.pauseVideo();
      setIsPlaying(false);
      if (yt.getCurrentTime) setCurrentTime(yt.getCurrentTime());
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setCurrentTime(video.currentTime);
  }, [isYouTube]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const seek = useCallback((time) => {
    if (isYouTube) {
      const yt = ytPlayerRef.current;
      if (!yt) return;
      const clamped = Math.max(0, Math.min(time, duration || 0));
      yt.seekTo(clamped, true);
      setCurrentTime(clamped);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(time, video.duration || 0));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  }, [isYouTube, duration]);

  const stepForward = useCallback(() => {
    if (isYouTube) return; // Not supported
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) pause();
    const next = Math.min(video.currentTime + FRAME_DURATION, video.duration || 0);
    video.currentTime = next;
    setCurrentTime(next);
  }, [isYouTube, pause]);

  const stepBackward = useCallback(() => {
    if (isYouTube) return; // Not supported
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) pause();
    const prev = Math.max(video.currentTime - FRAME_DURATION, 0);
    video.currentTime = prev;
    setCurrentTime(prev);
  }, [isYouTube, pause]);

  const setPlaybackRate = useCallback((rate) => {
    if (isYouTube) {
      const yt = ytPlayerRef.current;
      if (yt) yt.setPlaybackRate(rate);
    } else {
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
    }
    setPlaybackRateState(rate);
  }, [isYouTube]);

  // Handle metadata loaded (HTML5 only)
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsYouTube(false);
    setDuration(video.duration);
    setVideoDimensions({
      width: video.videoWidth,
      height: video.videoHeight,
    });
    video.playbackRate = playbackRate;
  }, [playbackRate]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // ─── YouTube IFrame API ───────────────────────────────────────

  const setYouTubePlayer = useCallback((player) => {
    ytPlayerRef.current = player;
    setIsYouTube(true);
  }, []);

  const handleYouTubeReady = useCallback((player) => {
    const dur = player.getDuration();
    setDuration(dur || 0);
    // YouTube doesn't expose native resolution easily; use 16:9 default
    setVideoDimensions({ width: 1920, height: 1080 });

    // Start a polling interval to track currentTime during playback
    if (ytIntervalRef.current) clearInterval(ytIntervalRef.current);
    ytIntervalRef.current = setInterval(() => {
      const yt = ytPlayerRef.current;
      if (yt && yt.getCurrentTime) {
        setCurrentTime(yt.getCurrentTime());
      }
    }, 100); // 10fps polling for YouTube time sync
  }, []);

  // YouTube state constants: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
  const handleYouTubeStateChange = useCallback((state) => {
    if (state === 1) {
      setIsPlaying(true);
    } else if (state === 2 || state === 0) {
      setIsPlaying(false);
      const yt = ytPlayerRef.current;
      if (yt && yt.getCurrentTime) setCurrentTime(yt.getCurrentTime());
    }
    if (state === 0) {
      // Ended
      setIsPlaying(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (ytIntervalRef.current) clearInterval(ytIntervalRef.current);
    };
  }, []);

  return {
    videoRef,
    isYouTube,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    videoDimensions,
    play,
    pause,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    setPlaybackRate,
    handleLoadedMetadata,
    handleEnded,
    // YouTube-specific
    setYouTubePlayer,
    handleYouTubeReady,
    handleYouTubeStateChange,
  };
}
