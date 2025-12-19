import styles from './TransportControls.module.css';

interface Props {
  isPlaying: boolean;
  hasTrack: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPlay: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function TransportControls({
  isPlaying,
  hasTrack,
  canPrev,
  canNext,
  onPlay,
  onStop,
  onPrev,
  onNext,
}: Props) {
  return (
    <div className={styles.transport}>
      <button
        className={styles.button}
        onClick={onPrev}
        disabled={!canPrev}
        title="Previous"
      >
        <svg viewBox="0 0 24 24">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
        </svg>
      </button>

      <button
        className={`${styles.button} ${styles.playButton}`}
        onClick={onPlay}
        disabled={!hasTrack}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        <svg viewBox="0 0 24 24">
          {isPlaying ? (
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          ) : (
            <path d="M8 5v14l11-7z" />
          )}
        </svg>
      </button>

      <button
        className={styles.button}
        onClick={onNext}
        disabled={!canNext}
        title="Next"
      >
        <svg viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>

      <button
        className={styles.button}
        onClick={onStop}
        disabled={!hasTrack}
        title="Stop"
      >
        <svg viewBox="0 0 24 24">
          <path d="M6 6h12v12H6z" />
        </svg>
      </button>
    </div>
  );
}
