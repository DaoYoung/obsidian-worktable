import type { App, Component } from "obsidian";

export interface WidgetContext {
  app: App;
  component: Component;
  settings: Record<string, unknown>;
  dashboardEl: HTMLElement;
}
