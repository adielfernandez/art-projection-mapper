import type { ConfirmFn, ProjectController } from '../../io/projectController';
import type { Store } from '../../state/store';
import type { Binder } from '../controls';
import type { Thumbnails } from '../thumbnails';

/** What the panel reads from playback. */
export interface PlaybackInfo {
  /** Manual show: key of the playlist entry on screen in a frame, or null. */
  playingKey(frameId: string): number | null;
}

export interface PanelContext {
  store: Store;
  project: ProjectController;
  /** Ask in the bar at the top of the panel. */
  confirm: ConfirmFn;
  /** Ask right below `anchor` (a section's <summary> opens that section), where the action was taken. */
  confirmAt(anchor: HTMLElement): ConfirmFn;
  /** Remembers which collapsible sections are open, by key. */
  openState: Map<string, boolean>;
  binder: Binder;
  thumbs: Thumbnails;
  playback: PlaybackInfo;
}
