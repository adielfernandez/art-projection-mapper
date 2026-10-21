import type { ShowType } from '../../state/schema';
import { button, h, row, section, withHelp } from '../controls';
import type { PanelContext } from './context';

export function configSection(ctx: PanelContext): HTMLElement {
  const { store, project, confirm, binder } = ctx;

  const folder = h('div', { class: 'folder' });
  const reopen = button('', () => void project.reopen(confirm), 'primary wide');
  const load = button('Load…', () => void project.open(confirm));
  load.title = 'Open a project folder';
  const save = button('Save', () => void project.save(confirm), 'primary');
  save.title = 'Write config.json';
  const message = h('div', { class: 'message' });

  const showTypeButton = (type: ShowType, label: string) => {
    const btn = button(label, () => store.setShowType(type));
    binder.add(() => btn.classList.toggle('active', store.config.showType === type));
    return btn;
  };
  const showType = withHelp(
    row('Show type', h('div', { class: 'segmented' }, [showTypeButton('randomized', 'Randomized'), showTypeButton('manual', 'Manual')])),
    "Randomized: all frames draw from the shared asset pool in shuffled order. Manual: each frame plays its own playlist (in its Mapping section) in order; one asset stays up, an empty playlist stays black. Switching restarts every frame. Saved with the config.",
  );

  binder.add(() => {
    const rt = store.runtime;
    folder.textContent = rt.folderName ? `Folder: ${rt.folderName}` : 'No project folder open (default project)';
    folder.classList.toggle('muted', !rt.folderName);
    const canReopen = !!rt.reopenName && rt.reopenName !== rt.folderName;
    reopen.hidden = !canReopen;
    reopen.textContent = `Reopen project: ${rt.reopenName ?? ''}`;
    load.disabled = save.disabled = !project.supported;
    save.classList.toggle('attention', rt.configDirty);

    const m = rt.ioMessage;
    message.hidden = !m;
    message.className = `message ${m?.kind ?? ''}`;
    message.replaceChildren();
    if (m) {
      message.append(h('div', { text: m.text }));
      if (m.details?.length) message.append(h('ul', {}, m.details.map((d) => h('li', { text: d }))));
    }
  });

  return section(ctx.openState, 'config', 'Config', [
    folder,
    reopen,
    h('div', { class: 'button-row' }, [load, save]),
    message,
    showType,
  ], { defaultOpen: true });
}
