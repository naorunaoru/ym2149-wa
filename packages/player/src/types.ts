export interface Track {
  filename: string;
  displayName: string;
  artist: string;
}

export interface YmPlayerProps {
  tracks: Track[];
  basePath?: string;
  initialVolume?: number;
  autoPlay?: boolean;
  onTrackChange?: (index: number) => void;
  onError?: (error: Error) => void;
  className?: string;
}

export interface TrackMetadata {
  name: string;
  author: string;
  format: string;
  frameCount: number;
  frameRate: number;
}

export interface TrackDisplay {
  displayName: string;
  displayArtist: string;
  format: string;
}
