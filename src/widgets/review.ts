import { mountReviewWidget } from "./ReviewWidget";
import type { WidgetContext, WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountReviewWidget(containerEl, context);
};

export { mount };
