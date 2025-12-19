import { Track } from '../../types';
import { PlayingIndicator } from '../PlayingIndicator/PlayingIndicator';
import styles from './PlaylistItem.module.css';

interface Props {
  track: Track;
  index: number;
  displayName: string;
  displayArtist: string;
  format: string;
  isActive: boolean;
  isPlaying: boolean;
  getLevels: () => [number, number, number];
  onClick: () => void;
}

export function PlaylistItem({
  index,
  displayName,
  displayArtist,
  format,
  isActive,
  isPlaying,
  getLevels,
  onClick,
}: Props) {
  const className = [
    styles.item,
    isActive && styles.active,
    isPlaying && styles.playing,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className} onClick={onClick}>
      <div className={styles.trackNumber}>
        {isPlaying ? (
          <PlayingIndicator getLevels={getLevels} isPlaying={isPlaying} />
        ) : (
          <span className={styles.numberText}>{index + 1}</span>
        )}
      </div>
      <div className={styles.trackInfo}>
        <div className={styles.trackName}>{displayName}</div>
        <div className={styles.trackArtist}>{displayArtist}</div>
      </div>
      <span className={styles.trackFormat}>{format}</span>
    </li>
  );
}
