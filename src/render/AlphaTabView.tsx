/**
 * alphaTab renderer + synth player.
 *
 * Two ways to drive the cursor:
 *   - `mode="synth"`: alphaTab plays its own rendering.
 *   - `mode="clip"`: the original recording plays and `externalTime` walks the
 *     cursor through the score, so you can check the arrangement against what
 *     the student actually played.
 */

import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import { buildScore } from './score';
import type { Arrangement } from '../types';

export type CursorMode = 'synth' | 'clip';

interface Props {
  arrangement: Arrangement;
  title: string;
  mode: CursorMode;
  /** Seconds into the clip; only used in `clip` mode. */
  externalTime: number;
  onReady?: (api: alphaTab.AlphaTabApi) => void;
  onError?: (message: string) => void;
}

export function AlphaTabView({ arrangement, title, mode, externalTime, onReady, onError }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const [status, setStatus] = useState<'init' | 'ready' | 'failed'>('init');
  const [playerReady, setPlayerReady] = useState(false);
  const [message, setMessage] = useState('Loading the score renderer…');

  // Create the API once; re-rendering the score is a separate effect.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let api: alphaTab.AlphaTabApi | null = null;
    try {
      api = new alphaTab.AlphaTabApi(host, {
        core: {
          fontDirectory: '/font/',
          engine: 'svg',
          logLevel: alphaTab.LogLevel.Warning,
          // The score sits in its own scroll container well down the page. With
          // lazy loading on, alphaTab only renders the partials it thinks are
          // in view, which leaves the staff blank until you scroll it into
          // frame - and blank in screenshots and prints.
          enableLazyLoading: false,
        },
        display: {
          layoutMode: alphaTab.LayoutMode.Page,
          scale: 0.9,
        },
        notation: {
          // The React chrome already shows the title block; keep the score clean.
          elements: new Map<alphaTab.NotationElement, boolean>([
            [alphaTab.NotationElement.ScoreTitle, false],
            [alphaTab.NotationElement.ScoreSubTitle, false],
            [alphaTab.NotationElement.ScoreArtist, false],
            [alphaTab.NotationElement.ScoreAlbum, false],
            [alphaTab.NotationElement.ScoreWords, false],
            [alphaTab.NotationElement.ScoreMusic, false],
            [alphaTab.NotationElement.ScoreWordsAndMusic, false],
            [alphaTab.NotationElement.ScoreCopyright, false],
          ]),
        },
        player: {
          playerMode: alphaTab.PlayerMode.EnabledAutomatic,
          soundFont: '/soundfont/sonivox.sf3',
          scrollElement: host,
          enableCursor: true,
          enableUserInteraction: true,
        },
      });
      apiRef.current = api;
      api.error.on((e) => {
        setStatus('failed');
        const text = e instanceof Error ? e.message : String(e);
        setMessage(text);
        onError?.(text);
      });
      // `renderFinished` fires once per partial; `postRenderFinished` is the
      // one that means the whole sheet is on screen. Treating the first partial
      // as "ready" let the cursor sync below seek the player mid-render, which
      // cancelled the rest of the systems and left a single bar on screen.
      api.postRenderFinished.on(() => setStatus('ready'));
      api.playerReady.on(() => setPlayerReady(true));
      onReady?.(api);
    } catch (err) {
      setStatus('failed');
      const text = err instanceof Error ? err.message : String(err);
      setMessage(text);
      onError?.(text);
    }

    return () => {
      apiRef.current = null;
      api?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render whenever the arrangement changes (every edit).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    setStatus((s) => (s === 'failed' ? s : 'init'));
    try {
      const built = buildScore(arrangement, { title });
      // Without explicit indexes alphaTab renders only the first track, which
      // would drop the riff staff on the Standard and Full tiers.
      api.renderScore(
        built.score,
        built.score.tracks.map((t) => t.index),
      );
    } catch (err) {
      setStatus('failed');
      const text = err instanceof Error ? err.message : String(err);
      setMessage(`Could not build the score: ${text}`);
      onError?.(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement, title]);

  // Cursor follows the original clip.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || mode !== 'clip' || status !== 'ready' || !playerReady) return;
    // The score starts at beat 0 of the clip, so clip time maps straight onto
    // score time once the lead-in before the first beat is removed.
    const ms = Math.max(0, (externalTime - arrangement.beatOffset) * 1000);
    try {
      api.timePosition = ms;
    } catch {
      /* the player is not ready yet; the next tick will land */
    }
  }, [externalTime, mode, status, playerReady, arrangement.beatOffset]);

  return (
    <div className="relative">
      {status !== 'ready' && (
        <div
          className={`mb-2 rounded-md border px-3 py-2 text-sm ${
            status === 'failed'
              ? 'border-red-800 bg-red-950/60 text-red-200'
              : 'border-ink-600 bg-ink-800 text-slate-400'
          }`}
        >
          {status === 'failed' ? (
            <>
              <strong>Score renderer unavailable.</strong> {message} The chord chart and the text/PDF exports below
              still work.
            </>
          ) : (
            message
          )}
        </div>
      )}
      <div
        ref={hostRef}
        className="at-host max-h-[70vh] overflow-auto rounded-lg bg-white p-2"
        style={{ minHeight: status === 'failed' ? 0 : 220 }}
      />
    </div>
  );
}
