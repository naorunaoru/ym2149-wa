import styles from './Header.module.css';

export function Header() {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>YM2149 Player</h1>
      <p className={styles.subtitle}>Atari ST / ZX Spectrum Chiptune Player</p>
    </header>
  );
}
