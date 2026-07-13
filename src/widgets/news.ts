import { createHomeDb } from "../storage/homeDb";
import { createNewsService } from "../services/NewsService";
import { mountNewsWidget } from "./NewsWidget";
import type { WidgetContext, WidgetMount } from "./types";
import type { WorktableSettings } from "../settings";

const mount: WidgetMount = (containerEl, context) => {
  const settings = (context.settings ?? {}) as WorktableSettings;
  const folder = settings.newsFolder || "news";
  const news = createNewsService(context.app, folder);
  mountNewsWidget(containerEl, context, createHomeDb(), news);
};

export { mount };
