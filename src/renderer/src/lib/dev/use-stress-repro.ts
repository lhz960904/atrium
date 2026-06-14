import type { AtriumUIMessage } from '@shared/chat';
import { useEffect, useRef } from 'react';

type SetMessages = (
  updater: AtriumUIMessage[] | ((messages: AtriumUIMessage[]) => AtriumUIMessage[]),
) => void;

/** Console handle (dev only) for reproducing long-message render jank in any
 *  open thread without re-sending — see useStressRepro. */
type StressApi = {
  /** Inject N verbatim copies of the captured real message (static render / switch-lag baseline). */
  flood: (copies?: number) => Promise<void>;
  /** Replay the real message's text growing frame-by-frame — the streaming-freeze baseline. */
  stream: (charsPerTick?: number) => Promise<void>;
  /** Abort an in-progress stream. */
  stop: () => void;
  /** Remove every injected stress message, restoring the real thread. */
  clear: () => void;
};

const STRESS_PREFIX = 'stress-';
const notStress = (m: AtriumUIMessage): boolean => !m.id.startsWith(STRESS_PREFIX);

/**
 * The actual "AI Agent 记忆机制解析" answer captured from the DB (~32k chars,
 * ~178 small Prism code blocks). Loaded lazily so the fixture never ships in the
 * prod bundle — reproducing against the real bytes removes any guesswork about
 * what made it jank.
 */
async function loadReal(): Promise<AtriumUIMessage> {
  const mod = await import('./real-message.json');
  return (mod.default ?? mod) as unknown as AtriumUIMessage;
}

function withText(msg: AtriumUIMessage, id: string, text: string): AtriumUIMessage {
  return {
    ...msg,
    id,
    parts: msg.parts.map((p) => (p.type === 'text' ? { ...p, text } : p)),
  };
}

/**
 * Dev-only: exposes `window.__atriumStress` so the captured long message can be
 * injected (flood) or re-streamed (stream) into the current thread on demand,
 * reproducing the render jank deterministically as a baseline for the fixes.
 *
 * setMessages is read through a ref so the API survives re-renders even if the
 * handle isn't referentially stable — otherwise the cleanup would cancel an
 * in-flight stream on every render.
 */
export function useStressRepro(setMessages: SetMessages): void {
  const setRef = useRef(setMessages);
  setRef.current = setMessages;

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let raf = 0;
    const cancel = (): void => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const clear = (): void => {
      cancel();
      setRef.current((ms) => ms.filter(notStress));
    };

    const flood = async (copies = 1): Promise<void> => {
      cancel();
      const real = await loadReal();
      const base = performance.now();
      const injected = Array.from({ length: copies }, (_, i) => ({
        ...real,
        id: `${STRESS_PREFIX}${base}-${i}`,
      }));
      setRef.current((ms) => [...ms.filter(notStress), ...injected]);
      console.info(
        `[stress] flooded ${copies} copy(ies) of the real message. Scroll / switch threads to test static render. __atriumStress.clear() to remove.`,
      );
    };

    const stream = async (charsPerTick = 24): Promise<void> => {
      cancel();
      const real = await loadReal();
      const textPart = real.parts.find((p) => p.type === 'text');
      const full = textPart && 'text' in textPart ? textPart.text : '';
      const id = `${STRESS_PREFIX}${performance.now()}`;
      let i = 0;
      setRef.current((ms) => [...ms.filter(notStress), withText(real, id, '')]);
      const tick = (): void => {
        i = Math.min(full.length, i + charsPerTick);
        const slice = full.slice(0, i);
        setRef.current((ms) => ms.map((m) => (m.id === id ? withText(real, id, slice) : m)));
        if (i < full.length) raf = requestAnimationFrame(tick);
        else {
          raf = 0;
          console.info('[stress] stream complete');
        }
      };
      raf = requestAnimationFrame(tick);
      console.info(
        `[stress] streaming ~${full.length} chars @ ${charsPerTick}/frame. Stay scrolled to the bottom to trigger the auto-scroll reflow. __atriumStress.stop() to abort.`,
      );
    };

    const api: StressApi = { flood, stream, stop: cancel, clear };
    const w = window as unknown as { __atriumStress?: StressApi };
    w.__atriumStress = api;
    console.info(
      '[stress] dev repro ready: __atriumStress.flood() | .stream() | .stop() | .clear()',
    );

    return () => {
      cancel();
      delete w.__atriumStress;
    };
  }, []);
}
