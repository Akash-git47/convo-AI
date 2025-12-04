
export enum Theme {
  LIGHT = 'light',
  DARK = 'dark',
}

export interface TranscriptTurn {
  speaker: 'user' | 'ai';
  text: string;
  isFinal: boolean;
}
