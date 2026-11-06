/**
 * Escape closes the topmost thing. Editor modals listen in the capture phase and stop the event,
 * so it never reaches the session's handler, where Escape means Discard.
 */
export function onEscape(handler: () => void, signal: AbortSignal): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  }, { capture: true, signal });
}
