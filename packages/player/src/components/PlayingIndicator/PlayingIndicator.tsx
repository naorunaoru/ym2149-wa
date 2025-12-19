import { useEffect, useRef } from 'react';
import styles from './PlayingIndicator.module.css';

interface Props {
  getLevels: () => [number, number, number];
  isPlaying: boolean;
}

export function PlayingIndicator({ getLevels, isPlaying }: Props) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([null, null, null]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.transform = '';
      });
      return;
    }

    const update = () => {
      const [a, b, c] = getLevels();
      const bars = barsRef.current;
      if (bars[0]) bars[0].style.transform = `scaleY(${0.2 + a * 0.8})`;
      if (bars[1]) bars[1].style.transform = `scaleY(${0.2 + b * 0.8})`;
      if (bars[2]) bars[2].style.transform = `scaleY(${0.2 + c * 0.8})`;
      frameRef.current = requestAnimationFrame(update);
    };
    update();

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isPlaying, getLevels]);

  return (
    <div className={styles.indicator}>
      <span ref={(el) => { barsRef.current[0] = el; }} />
      <span ref={(el) => { barsRef.current[1] = el; }} />
      <span ref={(el) => { barsRef.current[2] = el; }} />
    </div>
  );
}
