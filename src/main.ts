/**
 * YM2149 Web Audio - Main entry point
 */

import { YmReplayer } from './ym-replayer';
import { parseYmFile, formatDuration, getYmDuration, YmFile } from './ym-parser';

const replayer = new YmReplayer();
let currentYmFile: YmFile | null = null;
let currentTrackIndex = -1;
let isPlaying = false;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function getPlaylistItems(): NodeListOf<HTMLElement> {
  return document.querySelectorAll('.playlist-item');
}

async function loadTrack(index: number): Promise<void> {
  const items = getPlaylistItems();
  if (index < 0 || index >= items.length) return;

  const item = items[index];
  const filename = item.dataset.file;
  if (!filename) return;

  const status = $('status');
  status.textContent = 'Loading ' + filename + '...';

  try {
    const response = await fetch('/' + filename);
    if (!response.ok) {
      throw new Error('Failed to fetch: ' + response.status);
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    currentYmFile = parseYmFile(data);
    currentTrackIndex = index;
    await replayer.load(currentYmFile);

    // Update now playing section
    const title = currentYmFile.metadata.songName || filename.replace('.ym', '');
    const author = currentYmFile.metadata.author || '';
    $('songTitle').textContent = title;
    $('songAuthor').textContent = author;
    $('songMeta').style.display = 'flex';
    $('songFormat').textContent = currentYmFile.header.format;
    $('songFrames').textContent = currentYmFile.header.frameCount.toString();
    $('totalTime').textContent = formatDuration(getYmDuration(currentYmFile));

    // Update playlist item with metadata
    const trackNameEl = item.querySelector('.track-name');
    const trackArtistEl = item.querySelector('.track-artist');
    if (trackNameEl) trackNameEl.textContent = title;
    if (trackArtistEl) trackArtistEl.textContent = author || '-';

    // Update format badge
    const formatEl = item.querySelector('.track-format');
    if (formatEl) formatEl.textContent = currentYmFile.header.format;

    // Enable transport buttons
    ($('playBtn') as HTMLButtonElement).disabled = false;
    ($('stopBtn') as HTMLButtonElement).disabled = false;
    ($('prevBtn') as HTMLButtonElement).disabled = index === 0;
    ($('nextBtn') as HTMLButtonElement).disabled = index === items.length - 1;

    // Update playlist item states
    items.forEach((el, i) => {
      el.classList.toggle('active', i === index);
      if (i !== index) el.classList.remove('playing');
    });

    status.textContent = '';
  } catch (err) {
    status.textContent = 'Error loading file: ' + (err as Error).message;
    console.error(err);
  }
}

function updatePlayIcon(): void {
  const playIcon = $('playIcon');
  if (isPlaying) {
    // Pause icon
    playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    // Play icon
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

function setPlayingState(playing: boolean): void {
  isPlaying = playing;
  updatePlayIcon();

  // Update playlist item playing state
  const items = getPlaylistItems();
  items.forEach((el, i) => {
    el.classList.toggle('playing', playing && i === currentTrackIndex);
  });
}

function setupPlayer(): void {
  const playBtn = $('playBtn') as HTMLButtonElement;
  const stopBtn = $('stopBtn') as HTMLButtonElement;
  const prevBtn = $('prevBtn') as HTMLButtonElement;
  const nextBtn = $('nextBtn') as HTMLButtonElement;
  const progressBar = $('progressBar');
  const progressFill = $('progressFill');
  const currentTimeEl = $('currentTime');
  const volumeSlider = $('volumeSlider') as HTMLInputElement;
  const volumeValue = $('volumeValue');

  // Playlist item selection - clicking always starts playback
  getPlaylistItems().forEach((item, index) => {
    item.addEventListener('click', async () => {
      await loadTrack(index);
      await replayer.play();
    });
  });

  // Transport controls
  playBtn.addEventListener('click', async () => {
    if (isPlaying) {
      replayer.pause();
    } else {
      await replayer.play();
    }
  });

  stopBtn.addEventListener('click', async () => {
    await replayer.stop();
  });

  prevBtn.addEventListener('click', async () => {
    if (currentTrackIndex > 0) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex - 1);
      if (wasPlaying) await replayer.play();
    }
  });

  nextBtn.addEventListener('click', async () => {
    const items = getPlaylistItems();
    if (currentTrackIndex < items.length - 1) {
      const wasPlaying = isPlaying;
      await loadTrack(currentTrackIndex + 1);
      if (wasPlaying) await replayer.play();
    }
  });

  // Volume control
  const updateVolume = () => {
    const value = parseInt(volumeSlider.value, 10);
    volumeValue.textContent = value + '%';
    // Convert 0-100 to 0-1 range
    replayer.setMasterVolume(value / 100);
  };
  volumeSlider.addEventListener('input', updateVolume);

  // Progress bar click to seek
  progressBar.addEventListener('click', (e) => {
    if (!currentYmFile) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const targetTime = ratio * getYmDuration(currentYmFile);
    replayer.seekTime(targetTime);
  });

  // Replayer callbacks
  replayer.setCallbacks({
    onStateChange: (state) => {
      const playing = state === 'playing';
      setPlayingState(playing);

      playBtn.disabled = !currentYmFile;
      stopBtn.disabled = !currentYmFile;

      if (state === 'stopped') {
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '0:00';
      }
    },
    onFrameChange: (frame, total) => {
      if (total > 0) {
        const ratio = (frame / total) * 100;
        progressFill.style.width = ratio + '%';
        currentTimeEl.textContent = formatDuration(replayer.getCurrentTime());
      }
    },
    onError: (error) => {
      $('status').textContent = 'Playback error: ' + error.message;
    }
  });

  // Initial volume display
  updateVolume();
}

document.addEventListener('DOMContentLoaded', () => {
  setupPlayer();
});
