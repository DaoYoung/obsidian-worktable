import { createHomeDb } from "../storage/homeDb";
import { mountTodoWidget } from "./TodoWidget";
import type { WidgetContext, WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountTodoWidget(containerEl, context, createHomeDb());
};

export { mount };
