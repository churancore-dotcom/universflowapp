import { Capacitor, registerPlugin } from '@capacitor/core';

interface VoiceSearchPluginShape {
  listen(): Promise<{ transcript?: string; cancelled?: boolean }>;
}

const NativeVoiceSearch = registerPlugin<VoiceSearchPluginShape>('VoiceSearch');

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

function cleanSpokenQuery(value: string) {
  return value
    .replace(/\b(search|play|song|music|please|univers\s*flow|universe\s*flow)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listenInBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechCtor) {
      reject(new Error('Speech search is not supported on this browser'));
      return;
    }

    const recognition = new SpeechCtor();
    let settled = false;
    const finish = (value?: string, err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      try { recognition.stop(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(cleanSpokenQuery(value || ''));
    };

    const timeoutId = window.setTimeout(() => finish(undefined, new Error('No voice heard')), 8000);
    recognition.lang = navigator.language || 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      finish(transcript);
    };
    recognition.onerror = (event) => {
      finish(undefined, new Error(event.error || 'Voice search failed'));
    };
    recognition.onend = () => {
      if (!settled) finish(undefined, new Error('No voice heard'));
    };

    recognition.start();
  });
}

export async function listenForSongName(): Promise<string> {
  if (Capacitor.isNativePlatform?.() === true) {
    const result = await NativeVoiceSearch.listen();
    return cleanSpokenQuery(result.transcript || '');
  }
  return listenInBrowser();
}
