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
  confirm: ConfirmFn;
  /** Remembers which collapsible sections are open, by key. */
  openState: Map<string, boolean>;
  binder: Binder;
  thumbs: Thumbnails;
  playback: PlaybackInfo;
}
