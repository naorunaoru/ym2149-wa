import { YmPlayer } from '@ym2149/player';
import { Header } from './components/Header/Header';
import { Footer } from './components/Footer/Footer';
import { tracks } from './tracks';
import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.container}>
      <Header />
      <YmPlayer tracks={tracks} initialVolume={50} />
      <Footer />
    </div>
  );
}
