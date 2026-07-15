import type { App, Component } from "obsidian";
import type { WorktableSettings } from "../settings";

export type WidgetId =
  | "pomodoro"
  | "todo"
  | "inquiry"
  | "active-recall"
  | "flowers"
  | "review"
  | "news"
  /** @deprecated legacy single-widget id kept for migration only; superseded by `inquiry` + `active-recall`. */
  | "learning";

export interface WidgetContext {
  app: App;
  component: Component;
  settings: WorktableSettings;
  dashboardEl: HTMLElement;
}

export type WidgetMount = (containerEl: HTMLElement, context: WidgetContext) => void | Promise<void>;

export interface WidgetDescriptor {
  id: WidgetId;
  title: string;
  mount: () => Promise<WidgetMount>;
}
