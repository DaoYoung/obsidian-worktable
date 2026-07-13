/**
 * Minimal stub of the `obsidian` package for unit tests.
 * Only the surface used by services / settings is provided.
 */

export class Plugin {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  loadData() {
    return Promise.resolve({});
  }
  saveData(_data: unknown) {
    return Promise.resolve();
  }
}

export class Component {
  private cleanups: Array<() => void> = [];
  register(cleanup: () => void) {
    this.cleanups.push(cleanup);
  }
  load() {}
  unload() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }
}

export class App {}

export class Setting {
  settingEl: HTMLElement;
  constructor(settingEl: HTMLElement) {
    this.settingEl = settingEl;
  }
  setName(_name: string) {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  addText(cb: (t: any) => unknown) {
    cb({
      setValue: () => this,
      setPlaceholder: () => this,
      onChange: () => this,
    });
    return this;
  }
  addToggle(cb: (t: any) => unknown) {
    cb({
      setValue: () => this,
      onChange: () => this,
    });
    return this;
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement;
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {} as HTMLElement;
  }
  display() {}
}

export class ItemView extends Component {
  containerEl: HTMLElement;
  constructor(_leaf: unknown) {
    super();
    this.containerEl = document.createElement("div");
  }
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
  getIcon() {
    return "";
  }
  async onOpen() {}
  async onClose() {
    this.unload();
  }
}

export class WorkspaceLeaf {}

export class TFile {
  path: string;
  basename: string;
  constructor(path: string) {
    this.path = path;
    this.basename = path.split("/").pop() ?? path;
  }
}

export class TFolder {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}

export const MarkdownRenderer = {
  render: () => Promise.resolve(),
};

export const Notice = class {
  constructor(_msg: string, _timeout?: number) {}
};