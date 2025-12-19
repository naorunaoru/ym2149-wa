import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      YM2149 PSG emulation using Web Audio API
      <br />
      <a href="https://github.com/user/ym2149-wa" target="_blank" rel="noopener noreferrer">
        View on GitHub
      </a>
    </footer>
  );
}
