import { Track } from '../../types';
import { PlaylistItem } from '../PlaylistItem/PlaylistItem';
import styles from './Playlist.module.css';

interface TrackDisplay {
  displayName: string;
  displayArtist: string;
  format: string;
}

interface Props {
  tracks: Track[];
  trackDisplays: TrackDisplay[];
  currentIndex: number;
  playingIndex: number;
  getLevels: () => [number, number, number];
  onTrackSelect: (index: number) => void;
}

export function Playlist({
  tracks,
  trackDisplays,
  currentIndex,
  playingIndex,
  getLevels,
  onTrackSelect,
}: Props) {
  return (
    <div className={styles.section}>
      <div className={styles.header}>Playlist</div>
      <ul className={styles.list}>
        {tracks.map((track, index) => {
          const display = trackDisplays[index] || {
            displayName: track.displayName,
            displayArtist: track.artist,
            format: 'YM',
          };
          return (
            <PlaylistItem
              key={track.filename}
              track={track}
              index={index}
              displayName={display.displayName}
              displayArtist={display.displayArtist}
              format={display.format}
              isActive={index === currentIndex}
              isPlaying={index === playingIndex}
              getLevels={getLevels}
              onClick={() => onTrackSelect(index)}
            />
          );
        })}
      </ul>
    </div>
  );
}
