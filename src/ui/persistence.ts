/**
 * Where saved games live.
 *
 * Two places, for two different needs: the browser's local storage for the
 * quick save a player reaches for between turns, and a downloaded file for a
 * campaign they want to keep, move to another machine or send to somebody.
 *
 * Local storage can be full, disabled or cleared by the browser at any time,
 * so every access is guarded and failure is reported rather than swallowed.
 */
import type { CampaignState } from '../core/campaign';
import { campaignFromJson, campaignToJson } from '../core/campaign';

const SLOT_KEY = 'regna:save:1';
const META_KEY = 'regna:save:1:meta';

export interface SaveMeta {
  readonly faction: string;
  readonly year: number;
  readonly turn: number;
  readonly savedAt: string;
}

export type SaveOutcome = { ok: true } | { ok: false; reason: string };

export function saveToBrowser(state: CampaignState): SaveOutcome {
  try {
    const text = campaignToJson(state);
    const meta: SaveMeta = {
      faction: state.player as string,
      year: state.year,
      turn: state.turn,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(SLOT_KEY, text);
    window.localStorage.setItem(META_KEY, JSON.stringify(meta));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `The browser would not store the save (${message}). Download it instead.`,
    };
  }
}

export function browserSaveMeta(): SaveMeta | undefined {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SaveMeta;
    return typeof parsed?.year === 'number' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function loadFromBrowser(): CampaignState | undefined {
  try {
    const text = window.localStorage.getItem(SLOT_KEY);
    if (!text) return undefined;
    return campaignFromJson(text);
  } catch {
    return undefined;
  }
}

export function clearBrowserSave(): void {
  try {
    window.localStorage.removeItem(SLOT_KEY);
    window.localStorage.removeItem(META_KEY);
  } catch {
    // Nothing to do: the save is already unreachable.
  }
}

/** Offers the campaign to the player as a file. */
export function downloadSave(state: CampaignState): void {
  const text = campaignToJson(state);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `regna-${state.player as string}-${state.year}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks for a save file and reads it. */
export function uploadSave(): Promise<CampaignState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file was chosen.'));
        return;
      }
      file
        .text()
        .then((text) => resolve(campaignFromJson(text)))
        .catch((error: unknown) =>
          reject(error instanceof Error ? error : new Error(String(error))),
        );
    });
    input.click();
  });
}
