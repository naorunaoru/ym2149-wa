/**
 * YM2149 Web Audio - Main entry point
 */

import { YmReplayer } from './ym-replayer';
import { parseYmFile, formatDuration, getYmDuration, YmFile } from './ym-parser';

const replayer = new YmReplayer();
let currentYmFile: YmFile | null = null;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

async function loadYmFile(filename: string): Promise<void> {
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
    replayer.load(currentYmFile);

    // Update UI
    $('songInfo').style.display = 'block';
    $('songTitle').textContent = currentYmFile.metadata.songName || filename;
    $('songAuthor').textContent = currentYmFile.metadata.author || 'Unknown';
    $('songFormat').textContent = currentYmFile.header.format;
    $('songFrames').textContent = currentYmFile.header.frameCount.toString();
    $('totalTime').textContent = formatDuration(getYmDuration(currentYmFile));

    // Enable transport buttons
    ($('playBtn') as HTMLButtonElement).disabled = false;
    ($('stopBtn') as HTMLButtonElement).disabled = false;

    // Update song button states
    document.querySelectorAll('.song-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.file === filename);
    });

    status.textContent = 'Loaded: ' + (currentYmFile.metadata.songName || filename);
  } catch (err) {
    status.textContent = 'Error loading file: ' + (err as Error).message;
    console.error(err);
  }
}

function setupPlayer(): void {
  const playBtn = $('playBtn') as HTMLButtonElement;
  const pauseBtn = $('pauseBtn') as HTMLButtonElement;
  const stopBtn = $('stopBtn') as HTMLButtonElement;
  const progressBar = $('progressBar');
  const progressFill = $('progressFill');
  const currentTimeEl = $('currentTime');

  // Song selection buttons
  document.querySelectorAll('.song-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filename = (btn as HTMLElement).dataset.file;
      if (filename) {
        loadYmFile(filename);
      }
    });
  });

  // Transport controls
  playBtn.addEventListener('click', async () => {
    await replayer.play();
  });

  pauseBtn.addEventListener('click', () => {
    replayer.pause();
  });

  stopBtn.addEventListener('click', async () => {
    await replayer.stop();
  });

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
      playBtn.disabled = state === 'playing' || !currentYmFile;
      pauseBtn.disabled = state !== 'playing';
      stopBtn.disabled = !currentYmFile;

      if (state === 'stopped') {
        progressFill.style.width = '0%';
        currentTimeEl.textContent = '00:00';
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
}

document.addEventListener('DOMContentLoaded', () => {
  setupPlayer();
});
