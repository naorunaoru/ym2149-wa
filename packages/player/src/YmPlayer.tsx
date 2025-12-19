import { useState, useRef, useEffect, useCallback } from 'react';
import { YmReplayer, parseYmFile, YmFile } from '@ym2149/core';
import { Track, YmPlayerProps, TrackMetadata, TrackDisplay } from './types';
import { NowPlaying } from './components/NowPlaying/NowPlaying';
import { ProgressBar } from './components/ProgressBar/ProgressBar';
import { TransportControls } from './components/TransportControls/TransportControls';
import { VolumeControl } from './components/VolumeControl/VolumeControl';
import { Playlist } from './components/Playlist/Playlist';
import styles from './YmPlayer.module.css';

export function YmPlayer({
  tracks,
  basePath = '',
  initialVolume = 50,
  autoPlay = false,
  onTrackChange,
  onError,
  className,
}: YmPlayerProps) {
  const replayerRef = useRef<YmReplayer | null>(null);
  const ymFileRef = useRef<YmFile | null>(null);

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
      format: 'YM',
    }))
  );

  const playingIndex = isPlaying ? currentTrackIndex : -1;

  // Initialize replayer
  useEffect(() => {
    const replayer = new YmReplayer();
    replayerRef.current = replayer;

    replayer.setCallbacks({
      onStateChange: (state) => {
        setIsPlaying(state === 'playing');
      },
      onFrameChange: (frame, total) => {
        setCurrentFrame(frame);
        setTotalFrames(total);
      },
      onError: (error) => {
        setStatus(`Playback error: ${error.message}`);
        onError?.(error);
      },
    });

    replayer.setMasterVolume(initialVolume / 100);

    return () => {
      replayer.dispose();
    };
  }, []);

  // Update track displays when tracks prop changes
  useEffect(() => {
    setTrackDisplays(
      tracks.map((t) => ({
        displayName: t.displayName,
        displayArtist: t.artist,
        format: 'YM',
      }))
    );
  }, [tracks]);

  const loadTrack = useCallback(
    async (index: number) => {
      const replayer = replayerRef.current;
      if (!replayer || index < 0 || index >= tracks.length) return;

      const track = tracks[index];
      setStatus(`Loading ${track.filename}...`);

      try {
        const url = basePath
          ? `${basePath}${track.filename}`
          : `${import.meta.env.BASE_URL}${track.filename}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);
        const ymFile = parseYmFile(data);
        ymFileRef.current = ymFile;

        await replayer.load(ymFile);

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

        setStatus('');
        onTrackChange?.(index);
      } catch (err) {
        const error = err as Error;
        setStatus(`Error loading file: ${error.message}`);
        onError?.(error);
        console.error(err);
      }
    },
    [tracks, basePath, onTrackChange, onError]
  );

  // Auto-play first track
  useEffect(() => {
    if (autoPlay && tracks.length > 0 && currentTrackIndex === -1) {
      loadTrack(0).then(() => {
        replayerRef.current?.play();
      });
    }
  }, [autoPlay, tracks.length, currentTrackIndex, loadTrack]);

  const handleTrackSelect = useCallback(
    async (index: number) => {
      await loadTrack(index);
      await replayerRef.current?.play();
    },
    [loadTrack]
  );

  const handlePlay = useCallback(async () => {
    if (isPlaying) {
      replayerRef.current?.pause();
    } else {
      await replayerRef.current?.play();
    }
  }, [isPlaying]);

  const handleStop = useCallback(async () => {
    await replayerRef.current?.stop();
  }, []);

  const handlePrev = useCallback(async () => {
    if (currentTrackIndex > 0) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex - 1);
      if (wasPlaying) await replayerRef.current?.play();
    }
  }, [currentTrackIndex, isPlaying, loadTrack]);

  const handleNext = useCallback(async () => {
    if (currentTrackIndex < tracks.length - 1) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex + 1);
      if (wasPlaying) await replayerRef.current?.play();
    }
  }, [currentTrackIndex, isPlaying, tracks.length, loadTrack]);

  const handleSeek = useCallback((time: number) => {
    replayerRef.current?.seekTime(time);
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    replayerRef.current?.setMasterVolume(newVolume / 100);
  }, []);

  const getLevels = useCallback((): [number, number, number] => {
    return replayerRef.current?.getChannelLevels() ?? [0, 0, 0];
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
