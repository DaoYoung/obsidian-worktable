import { mountActiveRecallWidget } from "./ActiveRecallWidget";
import type { WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountActiveRecallWidget(containerEl, context);
};

export { mount };