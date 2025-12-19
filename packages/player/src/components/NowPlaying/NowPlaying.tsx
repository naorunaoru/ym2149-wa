import { TrackMetadata } from '../../types';
import styles from './NowPlaying.module.css';

interface Props {
  track: TrackMetadata | null;
}

export function NowPlaying({ track }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.label}>Now Playing</div>
      <h2 className={styles.title}>{track?.name || 'Select a track'}</h2>
      {track?.author && <div className={styles.author}>{track.author}</div>}
      {track && (
        <div className={styles.meta}>
          <span>Format: <span className={styles.value}>{track.format}</span></span>
          <span>Frames: <span className={styles.value}>{track.frameCount}</span></span>
        </div>
      )}
    </div>
  );
}
