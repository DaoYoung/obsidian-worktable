import { mountLearningWidget } from "./LearningWidget";
import type { WidgetContext, WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountLearningWidget(containerEl, context);
};

export { mount };
