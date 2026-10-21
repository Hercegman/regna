/**
 * Where the interface meets the sound.
 *
 * Two things, both of them small on purpose. A browser will not let audio
 * start without a gesture, so the first click anywhere is what brings the
 * context up; and every button in the game should click, which is one
 * delegated listener rather than a line in every handler that makes one.
 */
import { clickSound, setSoundMuted, soundMuted, wakeAudio } from './sound';
import { el } from '../ui/dom';

let installed = false;

export function installSoundGestures(): void {
  if (installed) return;
  installed = true;
  const wake = (): void => wakeAudio();
  // Capture, so the context is awake before whatever the click does gets to
  // ask for a sound.
  window.addEventListener('pointerdown', wake, { capture: true });
  window.addEventListener('keydown', wake, { capture: true });
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('button')) clickSound();
    },
    { capture: true },
  );
}

/**
 * The toggle.
 *
 * It paints itself from the stored setting rather than from a flag kept in
 * the screen that made it, so the button in the battle and the button on the
 * map can never disagree about whether the sound is on.
 */
export function soundButton(className = 'tool'): HTMLElement {
  const button = el('button', {
    class: className,
    title: 'Sound on or off',
  }) as HTMLButtonElement;
  const paint = (): void => {
    button.textContent = soundMuted() ? '\u{1F507} Sound' : '\u{1F50A} Sound';
  };
  button.addEventListener('click', () => {
    setSoundMuted(!soundMuted());
    paint();
  });
  paint();
  return button;
}
