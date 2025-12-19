import { useRef } from 'react';
import styles from './ProgressBar.module.css';

interface Props {
  currentFrame: number;
  totalFrames: number;
  frameRate: number;
  onSeek: (time: number) => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ProgressBar({ currentFrame, totalFrames, frameRate, onSeek }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  const percentage = totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0;
  const currentTime = frameRate > 0 ? currentFrame / frameRate : 0;
  const totalTime = frameRate > 0 ? totalFrames / frameRate : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current || totalFrames === 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetTime = ratio * totalTime;
    onSeek(targetTime);
  };

  return (
    <div className={styles.section}>
      <div ref={barRef} className={styles.bar} onClick={handleClick}>
        <div className={styles.fill} style={{ width: `${percentage}%` }} />
      </div>
      <div className={styles.timeRow}>
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(totalTime)}</span>
      </div>
    </div>
  );
}
