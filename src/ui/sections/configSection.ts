import { button, h, section } from '../controls';
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
  ], { defaultOpen: true });
}
