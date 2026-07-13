// Stub - will be provided by integration agent
export interface NewsItem {
  path: string;
  name: string;
  mtime: number;
}

export interface NewsService {
  getNewsItems(): Promise<NewsItem[]>;
}

export function createNewsService(): NewsService {
  return {
    async getNewsItems(): Promise<NewsItem[]> {
      // Integration agent will provide actual implementation using app.vault
      return [];
    },
  };
}
