import type { ConfirmFn, ProjectController } from '../../io/projectController';
import type { Store } from '../../state/store';
import type { Binder } from '../controls';

export interface PanelContext {
  store: Store;
  project: ProjectController;
  confirm: ConfirmFn;
  /** Remembers which collapsible sections are open, by key. */
  openState: Map<string, boolean>;
  binder: Binder;
}
