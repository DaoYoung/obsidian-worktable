import type { App, Component } from "obsidian";
import type { WorktableSettings } from "../settings";

export type WidgetId =
  | "pomodoro"
  | "todo"
  | "learning"
  | "flowers"
  | "review"
  | "news";

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
