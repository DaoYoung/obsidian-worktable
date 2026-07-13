import { createHomeDb } from "../storage/homeDb";
import { mountFlowersWidget } from "./FlowersWidget";
import type { WidgetContext, WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountFlowersWidget(containerEl, context, createHomeDb());
};

export { mount };
