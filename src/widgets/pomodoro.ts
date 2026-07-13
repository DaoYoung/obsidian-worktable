import { createPomDb } from "../storage/pomodoroDb";
import { mountPomodoroWidget } from "./PomodoroWidget";
import type { WidgetContext, WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountPomodoroWidget(containerEl, context, createPomDb());
};

export { mount };
