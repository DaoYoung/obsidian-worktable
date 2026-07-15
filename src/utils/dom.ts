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

export type ElOptions = {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: Array<Node | string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      node.setAttribute(name, value);
    }
  }
  if (options.children) {
    for (const child of options.children) {
      if (typeof child === "string") {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
  }
  return node;
}

export function clearChildren(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}