import { mountInquiryLearningWidget } from "./InquiryLearningWidget";
import type { WidgetMount } from "./types";

const mount: WidgetMount = (containerEl, context) => {
  mountInquiryLearningWidget(containerEl, context);
};

export { mount };