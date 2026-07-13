const HTML_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "&": "&amp;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[<>"'&]/g, (c) => HTML_ESCAPES[c] ?? c);
}

export function queryById<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`#${CSS.escape(id)}`);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; html?: string; attrs?: Record<string, string> } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = options.text;
  if (options.html != null) node.innerHTML = options.html;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  return node;
}
