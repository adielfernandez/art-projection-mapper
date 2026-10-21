/**
 * Accept files dragged in from the OS: highlight `el` while they hover over it and pass the
 * drop to `onDrop` (synchronously, as the browser only exposes the files during the event).
 */
export function dropZone(el: HTMLElement, onDrop: (dt: DataTransfer) => void, enabled: () => boolean): void {
  let depth = 0; // dragenter/leave also fire for children
  const accepts = (e: DragEvent) => !!e.dataTransfer && e.dataTransfer.types.includes('Files') && enabled();
  const clear = () => {
    depth = 0;
    el.classList.remove('drop-target');
  };
  el.addEventListener('dragenter', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('drop-target');
  });
  el.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation(); // the innermost zone wins
    e.dataTransfer!.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', (e) => {
    clear();
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(e.dataTransfer!);
  });
}

/** Files dropped anywhere else must not make the browser navigate away from the show. */
export function blockStrayDrops(): void {
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
