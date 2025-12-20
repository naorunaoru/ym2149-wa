import { useState, useRef, useEffect, useCallback } from 'react';
import {
  YmReplayer,
  parseYmFile,
  YmFile,
  Pt3Replayer,
  parsePt3File,
  Pt3File,
} from '@ym2149/core';
import { Track, YmPlayerProps, TrackMetadata, TrackDisplay } from './types';
import { NowPlaying } from './components/NowPlaying/NowPlaying';
import { ProgressBar } from './components/ProgressBar/ProgressBar';
import { TransportControls } from './components/TransportControls/TransportControls';
import { VolumeControl } from './components/VolumeControl/VolumeControl';
import { Playlist } from './components/Playlist/Playlist';
import styles from './YmPlayer.module.css';

/** Common interface for both replayers */
interface Replayer {
  play(): Promise<void>;
  pause(): void;
  stop(): Promise<void>;
  seekTime(seconds: number): void;
  setMasterVolume(volume: number): void;
  getChannelLevels(): [number, number, number];
  dispose(): void;
  setCallbacks(callbacks: {
    onStateChange?: (state: 'stopped' | 'playing' | 'paused') => void;
    onFrameChange?: (frame: number, total: number) => void;
    onError?: (error: Error) => void;
  }): void;
}

/** Detect file type from filename */
function isPt3File(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pt3');
}

export function YmPlayer({
  tracks,
  basePath = '',
  initialVolume = 50,
  autoPlay = false,
  onTrackChange,
  onError,
  className,
}: YmPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const ymReplayerRef = useRef<YmReplayer | null>(null);
  const pt3ReplayerRef = useRef<Pt3Replayer | null>(null);
  const activeReplayerRef = useRef<Replayer | null>(null);
  const ymFileRef = useRef<YmFile | null>(null);
  const pt3FileRef = useRef<Pt3File | null>(null);
  const volumeRef = useRef(initialVolume);

  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [currentTrack, setCurrentTrack] = useState<TrackMetadata | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [status, setStatus] = useState('');
  const [volume, setVolume] = useState(initialVolume);
  const [trackDisplays, setTrackDisplays] = useState<TrackDisplay[]>(() =>
    tracks.map((t) => ({
      displayName: t.displayName,
      displayArtist: t.artist,
      format: isPt3File(t.filename) ? 'PT3' : 'YM',
    })),
  );

  const playingIndex = isPlaying ? currentTrackIndex : -1;

  // Shared callbacks for both replayers
  const replayerCallbacks = {
    onStateChange: (state: 'stopped' | 'playing' | 'paused') => {
      setIsPlaying(state === 'playing');
    },
    onFrameChange: (frame: number, total: number) => {
      setCurrentFrame(frame);
      setTotalFrames(total);
    },
    onError: (error: Error) => {
      setStatus(`Playback error: ${error.message}`);
      onError?.(error);
    },
  };

  // Lazily initialize AudioContext and replayers on first user interaction
  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current) return;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const ymReplayer = new YmReplayer({ audioContext });
    const pt3Replayer = new Pt3Replayer({ audioContext });

    ymReplayerRef.current = ymReplayer;
    pt3ReplayerRef.current = pt3Replayer;

    ymReplayer.setCallbacks(replayerCallbacks);
    pt3Replayer.setCallbacks(replayerCallbacks);

    ymReplayer.setMasterVolume(volumeRef.current / 100);
    pt3Replayer.setMasterVolume(volumeRef.current / 100);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ymReplayerRef.current?.dispose();
      pt3ReplayerRef.current?.dispose();
      audioContextRef.current?.close();
    };
  }, []);

  // Update track displays when tracks prop changes
  useEffect(() => {
    setTrackDisplays(
      tracks.map((t) => ({
        displayName: t.displayName,
        displayArtist: t.artist,
        format: isPt3File(t.filename) ? 'PT3' : 'YM',
      })),
    );
  }, [tracks]);

  const loadTrack = useCallback(
    async (index: number) => {
      if (index < 0 || index >= tracks.length) return;

      // Initialize AudioContext on first user interaction
      ensureAudioContext();

      const track = tracks[index];
      const isPt3 = isPt3File(track.filename);

      setStatus(`Loading ${track.filename}...`);

      try {
        // Stop current replayer if any
        if (activeReplayerRef.current) {
          await activeReplayerRef.current.stop();
        }

        const url = basePath
          ? `${basePath}${track.filename}`
          : `${import.meta.env.BASE_URL}${track.filename}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);

        if (isPt3) {
          // Load PT3 file
          const pt3File = parsePt3File(data);
          pt3FileRef.current = pt3File;
          ymFileRef.current = null;

          const replayer = pt3ReplayerRef.current!;
          await replayer.load(pt3File);
          replayer.setMasterVolume(volumeRef.current / 100);
          activeReplayerRef.current = replayer;

          setCurrentTrackIndex(index);
          setCurrentTrack({
            name: pt3File.title || track.displayName,
            author: pt3File.author || '',
            format: 'PT3',
            frameCount: replayer.getFrameCount(),
            frameRate: 50,
          });

          setTrackDisplays((prev) => {
            const updated = [...prev];
            updated[index] = {
              displayName: pt3File.title || track.displayName,
              displayArtist: pt3File.author || '-',
              format: 'PT3',
            };
            return updated;
          });
        } else {
          // Load YM file
          const ymFile = parseYmFile(data);
          ymFileRef.current = ymFile;
          pt3FileRef.current = null;

          const replayer = ymReplayerRef.current!;
          await replayer.load(ymFile);
          replayer.setMasterVolume(volumeRef.current / 100);
          activeReplayerRef.current = replayer;

          setCurrentTrackIndex(index);
          setCurrentTrack({
            name: ymFile.metadata.songName || track.displayName,
            author: ymFile.metadata.author || '',
            format: ymFile.header.format,
            frameCount: ymFile.header.frameCount,
            frameRate: ymFile.header.frameRate,
          });

          setTrackDisplays((prev) => {
            const updated = [...prev];
            updated[index] = {
              displayName: ymFile.metadata.songName || track.displayName,
              displayArtist: ymFile.metadata.author || '-',
              format: ymFile.header.format,
            };
            return updated;
          });
        }

        setStatus('');
        onTrackChange?.(index);
      } catch (err) {
        const error = err as Error;
        setStatus(`Error loading file: ${error.message}`);
        onError?.(error);
        console.error(err);
      }
    },
    [tracks, basePath, onTrackChange, onError, ensureAudioContext],
  );

  // Auto-play first track
  useEffect(() => {
    if (autoPlay && tracks.length > 0 && currentTrackIndex === -1) {
      loadTrack(0).then(() => {
        activeReplayerRef.current?.play();
      });
    }
  }, [autoPlay, tracks.length, currentTrackIndex, loadTrack]);

  const handleTrackSelect = useCallback(
    async (index: number) => {
      await loadTrack(index);
      await activeReplayerRef.current?.play();
    },
    [loadTrack],
  );

  const handlePlay = useCallback(async () => {
    if (isPlaying) {
      activeReplayerRef.current?.pause();
    } else {
      await activeReplayerRef.current?.play();
    }
  }, [isPlaying]);

  const handleStop = useCallback(async () => {
    await activeReplayerRef.current?.stop();
  }, []);

  const handlePrev = useCallback(async () => {
    if (currentTrackIndex > 0) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex - 1);
      if (wasPlaying) await activeReplayerRef.current?.play();
    }
  }, [currentTrackIndex, isPlaying, loadTrack]);

  const handleNext = useCallback(async () => {
    if (currentTrackIndex < tracks.length - 1) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex + 1);
      if (wasPlaying) await activeReplayerRef.current?.play();
    }
  }, [currentTrackIndex, isPlaying, tracks.length, loadTrack]);

  const handleSeek = useCallback((time: number) => {
    activeReplayerRef.current?.seekTime(time);
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    volumeRef.current = newVolume;
    activeReplayerRef.current?.setMasterVolume(newVolume / 100);
  }, []);

  const getLevels = useCallback((): [number, number, number] => {
    return activeReplayerRef.current?.getChannelLevels() ?? [0, 0, 0];
  }, []);

  const frameRate = currentTrack?.frameRate ?? 50;

  return (
    <div className={`${styles.player} ${className || ''}`}>
      <NowPlaying track={currentTrack} />
      <ProgressBar
        currentFrame={currentFrame}
        totalFrames={totalFrames}
        frameRate={frameRate}
        onSeek={handleSeek}
      />
      <TransportControls
        isPlaying={isPlaying}
        hasTrack={currentTrack !== null}
        canPrev={currentTrackIndex > 0}
        canNext={currentTrackIndex < tracks.length - 1}
        onPlay={handlePlay}
        onStop={handleStop}
        onPrev={handlePrev}
        onNext={handleNext}
      />
      <VolumeControl volume={volume} onVolumeChange={handleVolumeChange} />
      <Playlist
        tracks={tracks}
        trackDisplays={trackDisplays}
        currentIndex={currentTrackIndex}
        playingIndex={playingIndex}
        getLevels={getLevels}
        onTrackSelect={handleTrackSelect}
      />
      {status && <div className={styles.status}>{status}</div>}
    </div>
  );
}
