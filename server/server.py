#!/usr/bin/env python3
"""
cloakfetch — local CORS-friendly proxy that fetches URLs via CloakBrowser
(stealth Chromium with C++ source-level fingerprint patches → bypasses
Cloudflare, FingerprintJS, etc. that block public CORS proxies).

Endpoints:
  GET  /health                       → JSON {ok, browserReady, uptimeSec, cacheSize, cacheMax}
  GET  /fetch?url=<URL>              → JSON {ok, url, title, html, markdown, length, elapsedMs, cacheHit}
  POST /ai/questions                 → JSON {title, text, count<=3} → AI quiz (mc/cloze/tf/short)
  POST /ai/extract                   → JSON {title, text, maxPoints<=10} → key points list
  POST /ai/expand                    → JSON {name, context?} → {subject, translation, pos, markdown}
  GET  /ai/health                    → JSON {ok, baseUrl, model}  (no token)

Run:
  ~/.cloakbrowser-env/bin/python server/server.py [--port 8765]

The server runs on 127.0.0.1 only — never exposes to LAN/internet.
CORS: Access-Control-Allow-Origin: * (Obsidian is a local file:// app).
"""

import argparse
import json
import logging
import os
import re
import secrets
import signal
import sys
import threading
import time
import urllib.request
import urllib.parse
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address, ip_network

LOG = logging.getLogger("cloakfetch")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

# ── Constants ─────────────────────────────────────────────────────────────────
_MAX_BODY_SIZE = 2 * 1024 * 1024   # 2 MB max request body
_MAX_URL_LENGTH = 8192             # 8 KB max URL
_CACHE_MAX = 32
_START_TIME = time.time()

# Reserved networks for SSRF protection (RFC 1918, RFC 4193, RFC 6890, loopback)
_RESERVED_NETWORKS = (
    ip_network("10.0.0.0/8"),
    ip_network("172.16.0.0/12"),
    ip_network("192.168.0.0/16"),
    ip_network("169.254.0.0/16"),   # link-local
    ip_network("127.0.0.0/8"),      # loopback
    ip_network("::1/128"),          # IPv6 loopback
    ip_network("fc00::/7"),          # IPv6 unique local
    ip_network("fe80::/10"),         # IPv6 link-local
    ip_network("0.0.0.0/8"),         # current network
)

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Worktable-Token",
    "Access-Control-Max-Age": "86400",
}

# ── Global state ──────────────────────────────────────────────────────────────
_BROWSER = None
_BROWSER_LOCK = threading.Lock()
_BROWSER_READY = False
_BROWSER_ERROR = None
_CACHE = OrderedDict()
_SERVICE_TOKEN = None
_CONFIG_PATH = None

# Fetch worker state
_FETCH_JOBS = []
_FETCH_RESULTS = {}
_FETCH_CV = threading.Condition(threading.Lock())
_SHUTDOWN_EVENT = threading.Event()


# ── Config loading ────────────────────────────────────────────────────────────
def _load_config() -> dict:
    """Load server config with precedence: env, ~/.config/obsidian-worktable/server.json,
    then fallback defaults. Does NOT read ~/.claude/settings.json for AI config here."""
    cfg = {
        "host": "127.0.0.1",
        "port": 8765,
        "serviceToken": "",
        "aiAuthToken": "",
        "aiBaseUrl": "https://api.anthropic.com",
        "aiModel": "claude-sonnet-4-5",
        "aiMaxTokens": 2048,
        "aiTimeout": 60,
        "upstreamFetchTimeout": 30,
    }

    def _to_env_name(k: str) -> str:
        out = []
        for i, ch in enumerate(k):
            if ch.isupper() and i > 0:
                out.append("_")
            out.append(ch.upper())
        return "WORKTABLE_" + "".join(out)

    def _apply_env(target: dict) -> None:
        for key, value in target.items():
            env_key = _to_env_name(key)
            val = os.environ.get(env_key)
            if val is None:
                continue
            if key in ("port", "aiMaxTokens", "aiTimeout", "upstreamFetchTimeout"):
                try:
                    target[key] = int(val)
                except ValueError:
                    pass
            else:
                target[key] = val

    # 1. Load config file (lower priority)
    global _CONFIG_PATH
    if _CONFIG_PATH is None:
        _CONFIG_PATH = os.path.expanduser("~/.config/obsidian-worktable/server.json")
    cfg_path = _CONFIG_PATH
    if cfg_path and os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                j = json.load(f)
            for key in j:
                if key in cfg:
                    cfg[key] = j[key]
        except Exception as e:
            LOG.warning("failed to read %s: %s", cfg_path, e)

    # 2. Environment (highest priority — overrides config file)
    _apply_env(cfg)

    return cfg


# ── Token management ──────────────────────────────────────────────────────────
def _get_service_token() -> str:
    global _SERVICE_TOKEN
    if _SERVICE_TOKEN is None:
        cfg = _load_config()
        _SERVICE_TOKEN = cfg.get("serviceToken", "") or ""
    return _SERVICE_TOKEN


def _check_auth(received_token: str = "") -> bool:
    """Return True if no service token is configured or if the request provides the correct one."""
    token = _get_service_token()
    if not token:
        return True
    return secrets.compare_digest(token, received_token or "")


# ── Browser (lazy-loaded, thread-safe via Lock) ───────────────────────────────
def _get_browser():
    """Lazy-load CloakBrowser on first use; share one instance across requests."""
    global _BROWSER, _BROWSER_READY, _BROWSER_ERROR
    if _BROWSER_READY:
        return _BROWSER
    with _BROWSER_LOCK:
        if _BROWSER_READY:
            return _BROWSER
        try:
            LOG.info("Launching CloakBrowser (first call)...")
            from cloakbrowser import launch
            _BROWSER = launch(headless=True, humanize=True)
            _BROWSER_READY = True
            _BROWSER_ERROR = None
            LOG.info("CloakBrowser ready")
        except Exception as e:
            _BROWSER_ERROR = str(e)
            LOG.error("Failed to launch CloakBrowser: %s", e)
            raise


# ── LRU cache ─────────────────────────────────────────────────────────────────
def _cache_get(url):
    if url in _CACHE:
        _CACHE.move_to_end(url)
        return _CACHE[url]
    return None


def _cache_put(url, payload):
    _CACHE[url] = payload
    _CACHE.move_to_end(url)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)


# ── SSRF protection ───────────────────────────────────────────────────────────
def _is_url_safe(url: str) -> bool:
    """Reject URLs that resolve to private/reserved networks."""
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        #Literal "localhost"
        if hostname.lower() in ("localhost", "localhost.localdomain"):
            return False
        # IP literal check
        try:
            addr = ip_address(hostname)
            if addr.is_reserved or addr.is_loopback or addr.is_multicast:
                return False
            for net in _RESERVED_NETWORKS:
                if addr in net:
                    return False
            return True
        except ValueError:
            pass
        # Not an IP — try DNS resolution (delayed but necessary)
        # We check after fetching; here we just allow non-IP hostnames
        return True
    except Exception:
        return False


# ── Fetch worker (browser thread-affine) ─────────────────────────────────────
class _FetchWorker(threading.Thread):
    """Dedicated worker thread that owns the CloakBrowser instance."""

    def __init__(self):
        super().__init__(daemon=True, name="cloakfetch-browser")
        self._stop = False

    def stop(self):
        with _FETCH_CV:
            self._stop = True
            _FETCH_CV.notify_all()

    def submit(self, job_id: int, url: str, timeout: int):
        done_evt = threading.Event()
        err = []
        with _FETCH_CV:
            _FETCH_JOBS.append((job_id, url, done_evt, err, timeout))
            _FETCH_CV.notify()
        done_evt.wait()
        if err:
            raise err[0]
        return _FETCH_RESULTS.pop(job_id, None)

    def run(self):
        try:
            _get_browser()
            LOG.info("Worker: pre-warm OK; ready for requests")
        except Exception as e:
            LOG.error("Worker: pre-warm failed: %s", e)
        while True:
            with _FETCH_CV:
                while not _FETCH_JOBS and not self._stop:
                    _FETCH_CV.wait()
                if self._stop:
                    return
                job = _FETCH_JOBS.pop(0)
            job_id, url, done_evt, err_holder, timeout = job
            try:
                _FETCH_RESULTS[job_id] = _do_fetch(url, timeout)
            except Exception as e:
                err_holder.append(e)
            finally:
                done_evt.set()


_WORKER: "_FetchWorker | None" = None


def _ensure_worker():
    global _WORKER
    if _WORKER is None:
        _WORKER = _FetchWorker()
        _WORKER.start()
    return _WORKER


def _do_fetch(url: str, timeout: int) -> dict:
    """Run inside the worker thread (browser-affine)."""
    browser = _get_browser()
    page = browser.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        title = page.title() or ""
        html = page.content() or ""
        # Lazy import keeps startup fast and the dependency optional — the
        # /fetch endpoint still works without trafilatura (just no markdown
        # extraction; the client falls back to htmlToArticle).
        markdown = ""
        try:
            import trafilatura  # type: ignore
            markdown = trafilatura.extract(
                html,
                include_comments=False,
                include_tables=True,
                output_format="markdown",
                favor_recall=True,
            ) or ""
        except Exception as e:
            LOG.warning("trafilatura extract failed: %s", e)
        return {"ok": True, "url": url, "title": title, "html": html,
                "markdown": markdown,
                "length": len(html), "cacheHit": False, "elapsedMs": 0}
    finally:
        try:
            page.close()
        except Exception:
            pass


def _fetch(url: str, timeout: int = 30) -> dict:
    """Submit a fetch job to the worker thread and wait for the result."""
    _ensure_worker()
    return _WORKER.submit(
        id(_ensure_worker) + id(threading.current_thread()),
        url,
        timeout,
    )


# ── AI helpers ────────────────────────────────────────────────────────────────
_AI_CFG: dict | None = None


def _load_ai_config() -> dict:
    """Resolve Anthropic API config from env / config file / ~/.claude/settings.json."""
    global _AI_CFG
    if _AI_CFG is not None:
        return _AI_CFG

    cfg = {
        "authToken": "",
        "baseUrl": "https://api.anthropic.com",
        "model": "claude-sonnet-4-5",
        "maxTokens": 2048,
        "timeout": 60,
    }

    # Env vars (highest priority)
    cfg["authToken"] = os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_API_KEY", "")
    cfg["baseUrl"] = os.environ.get("ANTHROPIC_BASE_URL", cfg["baseUrl"]).rstrip("/")
    cfg["model"] = os.environ.get("ANTHROPIC_MODEL", cfg["model"])

    # Config file (~/.config/obsidian-worktable/server.json)
    if not cfg["authToken"] and _CONFIG_PATH and os.path.isfile(_CONFIG_PATH):
        try:
            with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                j = json.load(f)
            cfg["authToken"] = j.get("aiAuthToken", "") or j.get("anthropicApiKey", "")
            if j.get("aiBaseUrl"):
                cfg["baseUrl"] = j["aiBaseUrl"].rstrip("/")
            if j.get("aiModel"):
                cfg["model"] = j["aiModel"]
            if j.get("aiTimeout"):
                cfg["timeout"] = int(j["aiTimeout"])
        except Exception as e:
            LOG.warning("failed to read AI config from %s: %s", _CONFIG_PATH, e)

    # ~/.claude/settings.json (last resort)
    if not cfg["authToken"]:
        settings_path = os.path.expanduser("~/.claude/settings.json")
        if os.path.isfile(settings_path):
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                env_block = settings.get("env", {}) or {}
                cfg["authToken"] = env_block.get("ANTHROPIC_AUTH_TOKEN") or env_block.get("ANTHROPIC_API_KEY", "")
                if "ANTHROPIC_BASE_URL" in env_block:
                    cfg["baseUrl"] = env_block["ANTHROPIC_BASE_URL"].rstrip("/")
                if "ANTHROPIC_MODEL" in env_block:
                    cfg["model"] = env_block["ANTHROPIC_MODEL"]
            except Exception as e:
                LOG.warning("failed to read ~/.claude/settings.json: %s", e)

    # Redact token from logs
    token_repr = f"{cfg['authToken'][:8]}***" if cfg["authToken"] else "(none)"
    LOG.info("AI config: baseUrl=%s model=%s token=%s", cfg["baseUrl"], cfg["model"], token_repr)

    _AI_CFG = cfg
    return cfg


_JSON_BLOCK_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def _call_anthropic(system: str, user: str, *, max_tokens: int = 2048, timeout: int = 60) -> str:
    """POST a single-turn message to an Anthropic-compatible endpoint."""
    cfg = _load_ai_config()
    if not cfg["authToken"]:
        raise RuntimeError("未配置 ANTHROPIC_AUTH_TOKEN(env 或 config)")

    url = f"{cfg['baseUrl']}/v1/messages"
    body = json.dumps({
        "model": cfg["model"],
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")

    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", cfg["authToken"])
    req.add_header("anthropic-version", "2023-06-01")
    req.add_header("anthropic-dangerous-direct-browser-access", "true")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")[:200]
        raise RuntimeError(f"AI API error {e.code}: {body}") from e

    parts = data.get("content", [])
    text_parts = [b.get("text", "") for b in parts if b.get("type") == "text"]
    if not text_parts:
        raise RuntimeError(f"AI returned no text: {data}")
    return "".join(text_parts).strip()


def _parse_questions_json(raw: str) -> list:
    """Best-effort parse of an AI response into a list of question objects."""
    for s in (raw,):
        try:
            obj = json.loads(s)
            if isinstance(obj, dict) and "questions" in obj:
                return obj["questions"]
            if isinstance(obj, list):
                return obj
        except json.JSONDecodeError:
            pass
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", s)
        if fence:
            try:
                obj = json.loads(fence.group(1).strip())
                if isinstance(obj, dict) and "questions" in obj:
                    return obj["questions"]
                if isinstance(obj, list):
                    return obj
            except json.JSONDecodeError:
                pass
        m = _JSON_BLOCK_RE.search(s)
        if m:
            try:
                obj = json.loads(m.group(0))
                if isinstance(obj, dict) and "questions" in obj:
                    return obj["questions"]
                if isinstance(obj, list):
                    return obj
            except json.JSONDecodeError:
                pass
    raise ValueError(f"AI response is not valid JSON: {raw[:300]!r}")


def _sanitize_questions(raw_questions: list, max_n: int) -> list:
    """Coerce model output into a clean, UI-safe list of question objects."""
    out = []
    for q in raw_questions[:max_n]:
        if not isinstance(q, dict):
            continue
        qtype = str(q.get("type", "")).lower().strip()
        if qtype not in ("mc", "cloze", "tf", "short"):
            continue
        text = str(q.get("text", "")).strip()
        answer = str(q.get("answer", "")).strip()
        if not text or not answer:
            continue
        item = {
            "type": qtype,
            "text": text[:500],
            "answer": answer[:200],
            "explanation": str(q.get("explanation", "")).strip()[:300],
        }
        if qtype == "mc":
            opts = q.get("options") or []
            if not isinstance(opts, list):
                continue
            opts = [str(o).strip() for o in opts if str(o).strip()]
            if len(opts) < 2:
                continue
            if answer not in opts:
                lc = {o.lower(): o for o in opts}
                if answer.lower() in lc:
                    item["answer"] = lc[answer.lower()]
                else:
                    if len(answer) == 1 and answer.upper().isalpha():
                        idx = ord(answer.upper()) - ord("A")
                        if 0 <= idx < len(opts):
                            item["answer"] = opts[idx]
                    else:
                        opts.append(answer)
            item["options"] = opts[:6]
        out.append(item)
    return out


def _generate_questions(title: str, text: str, count: int) -> list:
    snippet = text.strip()
    if len(snippet) > 6000:
        snippet = snippet[:6000] + "…(已截断)"
    system = (
        "你是一个学习助手。根据用户给的文章,生成理解题。"
        "严格只返回 JSON,不要任何解释、前言、Markdown 代码块标记。"
        "题目要紧扣文章核心概念,不同题考察不同方面,答案在原文中能找到。"
    )
    user = (
        f"文章标题:{title or '(无)'}\n\n"
        f"文章正文:\n{snippet}\n\n"
        f"请生成最多 {count} 道题。每道题类型四选一:\n"
        f'  - "mc": 单选题,4 个选项,恰好 1 个正确。fields: text, answer, options[4], explanation\n'
        f'  - "cloze": 填空题,用 ___ 表示空白。fields: text, answer, explanation\n'
        f'  - "tf": 判断题,answer 必须是 "对" 或 "错"。fields: text, answer, explanation\n'
        f'  - "short": 简答题,answer 是 1-5 个关键词。fields: text, answer, explanation\n\n'
        f"严格返回以下 JSON 格式,不要任何其他文字:\n"
        f'{{"questions":[{{"type":"...","text":"...","answer":"...","options":["...","...","...","..."],"explanation":"..."}}]}}\n'
    )
    raw = _call_anthropic(system, user, max_tokens=2048, timeout=60)
    questions = _parse_questions_json(raw)
    return _sanitize_questions(questions, count)


def _extract_keypoints(title: str, text: str, max_points: int = 8) -> list:
    snippet = text.strip()
    if len(snippet) > 8000:
        snippet = snippet[:8000] + "…(已截断)"
    system = (
        "你是一个学习助手。从一篇文章里提炼出最值得记住的知识点。"
        "严格只返回 JSON 数组,不要任何解释、前言、Markdown 代码块标记。"
        "每个知识点用 1-2 句简洁中文表达,不同点覆盖不同方面,避免重复。"
    )
    user = (
        f"文章标题:{title or '(无)'}\n\n"
        f"文章正文:\n{snippet}\n\n"
        f"请提炼出最多 {max_points} 个核心知识点。\n"
        f"返回 JSON 数组: [\"知识点 1\", \"知识点 2\", ...]\n"
        f"不要返回代码块标记,不要解释。"
    )
    raw = _call_anthropic(system, user, max_tokens=1024, timeout=60)

    def _try(s):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            pass
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", s)
        if fence:
            try:
                return json.loads(fence.group(1).strip())
            except json.JSONDecodeError:
                pass
        return None

    obj = _try(raw)
    if isinstance(obj, list):
        return [str(x).strip() for x in obj if str(x).strip()][:max_points]
    if isinstance(obj, dict) and "keyPoints" in obj:
        return [str(x).strip() for x in obj["keyPoints"] if str(x).strip()][:max_points]
    lines = [l.strip().lstrip("-•·").strip() for l in raw.splitlines()]
    return [l for l in lines if 5 < len(l) < 200][:max_points]


def _unescape_newlines(s: str) -> str:
    """Convert literal `\n` (two chars: backslash + n) to real newlines.

    The AI sometimes returns string fields where the source contains the
    two-character sequence `\\n` instead of a real newline. JSON.parse
    won't unescape those, and MarkdownRenderer then displays them
    verbatim.
    """
    return s.replace("\\n", "\n")


# Heuristics for "this string looks like source code". We never want code in
# the vocabulary learning path even if the model sneaks some in.
_CODE_MARKERS = (
    "```",       # fenced code block
    "function ", "function(",
    "const ", "let ", "var ",
    "import ", "from ", "require(",
    "def ", "class ",
    "console.", "System.out",
    "<script", "#!/",
)


def _looks_like_code(s: str) -> bool:
    if not s:
        return False
    return any(marker in s for marker in _CODE_MARKERS)


def _expand_knowledge_point(name: str, context: str = "") -> dict:
    """Ask the AI to organize a knowledge point.

    Returns a dict with:
      - subject: 中文学科分类(如 "英文词汇" / "数学" / "物理" / "化学" ...)
      - translation: 中文翻译或释义(英文单词必填,其他学科可空)
      - pos: 词性(英文单词必填)
      - markdown: 适合在 Obsidian 中预览的 Markdown 正文
      - raw: 原始 AI 输出（解析失败时的兜底）
    """
    snippet = context.strip()[:4000] if context else ""
    # Foreign-vocabulary detection: any short input with no Chinese characters
    # but containing Latin/accented letters is treated as foreign-language
    # learning (English words, phrases, café, naïve, …). We route it to the
    # "英文词汇" subject so the writer files it as vocabulary and the AI focuses
    # on the Chinese translation rather than a full subject write-up.
    _name = (name or "").strip()
    has_cjk = bool(re.search(r"[一-鿿]", _name))
    has_latin = bool(re.search(r"[A-Za-zÀ-ɏ]", _name))
    is_english_word = (not has_cjk) and has_latin and len(_name) <= 40
    if is_english_word:
        # English-vocabulary learning: the user typed an English word and
        # wants to learn its Chinese meaning. Force the model to stay in
        # vocabulary-learning territory even if the word has a strong
        # technical meaning (e.g. "spawn" → Python multiprocessing). The
        # subject hint alone isn't enough; the whole prompt has to
        # explicitly steer away from any non-linguistic interpretation.
        system = (
            "你是一个英文单词学习助手,负责把用户输入的英文单词整理成中文词汇卡片。"
            "请严格只返回 JSON 对象,不要任何其他文字、注释、Markdown 代码块。"
            "重要:用户输入的是英文单词,目的是学习它的中文含义,不是查任何技术文档。"
            "如果这个词恰好也是某个编程/技术/API 中的术语（例如 'spawn' 在 Python "
            "multiprocessing、Unreal Engine、游戏引擎中等),完全忽略那些技术含义,"
            "只把它当作一个普通英语单词来解释。"
        )
        user = (
            f"英文单词:{name}\n\n"
            + (f"额外参考上下文:\n{snippet}\n\n" if snippet else "")
            + "请用 JSON 返回这个英文单词的学习卡片(**只解释作为英文单词的含义,不要写任何代码、不要举编程/技术示例**):\n"
            + '  "subject": "英文词汇"\n'
            + '  "translation": 1-3 句中文释义(必填,例如「产卵;大量产生;引发」这种常规英文词汇含义)\n'
            + '  "pos": 词性(必填,n./v./adj./adv./prep./conj./pron./num./art./aux./interj.)\n'
            + '  "definition": 1-2 句中文解释,告诉用户这个单词在英文里通常怎么用(不要写代码、不要解释技术用法)\n'
            + '  "points": 3-5 条关键要点,每条都是中文,围绕单词本身的含义、常见搭配、近义词等\n'
            + '  "example": 留空字符串 "" —— 英文单词场景下不需要示例字段\n'
            + '  "contrast": 与意思相近的英文单词的区别(可选,可以空字符串)\n'
            + '  "refs": 参考资料(可选,可以空字符串)\n\n'
            + '{"subject":"英文词汇","translation":"...","pos":"...","definition":"...","points":["...","..."],"example":"","contrast":"...","refs":"..."}\n'
        )
    else:
        subject_hint = (
            '"subject": 一个简洁中文学科标签,如 数学 / 物理 / 化学 / 生物 / 历史 / 地理 / 政治 / 语文 / 经济 / 哲学 / 心理学 / 计算机 / 其他'
        )
        system = (
            "你是一个知识整理助手。请严格只返回 JSON 对象,不要任何其他文字、注释、Markdown 代码块。"
            "内容准确、简洁、有结构,不要编造不存在的引用。"
        )
        user = (
            f"知识点名称:{name}\n\n"
            + (f"额外参考上下文:\n{snippet}\n\n" if snippet else "")
            + "请用 JSON 返回一个知识点的结构化解释,字段如下:\n"
            + f"  {subject_hint}\n"
            + '  "definition": 1-3 句中文定义\n'
            + '  "translation": 中文翻译或释义（英文单词必填,其他学科可空字符串）\n'
            + '  "pos": 词性标注,英文单词必填（n./v./adj./adv./prep./conj./pron./num./art./aux./interj.）,其他学科可空字符串\n'
            + '  "points": 3-5 条关键要点(字符串数组)\n'
            + '  "example": 可运行的 Markdown 代码示例或一段使用场景(可选,可以空字符串)\n'
            + '  "contrast": 与其他易混淆概念的区别(可选,可以空字符串)\n'
            + '  "refs": 参考资料(可选,可以空字符串)\n\n'
            + '{"subject":"...","translation":"...","pos":"...","definition":"...","points":["...","..."],"example":"...","contrast":"...","refs":"..."}\n'
        )
    raw = _call_anthropic(system, user, max_tokens=1800, timeout=80)

    def _try_json(s):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            pass
        m = re.search(r"\{[\s\S]*\}", s)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", s)
        if fence:
            try:
                return json.loads(fence.group(1).strip())
            except json.JSONDecodeError:
                pass
        return None

    obj = _try_json(raw)
    if obj and isinstance(obj, dict):
        # For English-vocabulary learning the user explicitly does not want
        # code samples — even if the model writes some. The prompt asks for
        # example = "" and forbids code, but we also drop the example field
        # server-side as a safety net. The same goes for the `contrast`
        # field when it slipped into technical comparisons.
        drop_examples = is_english_word
        parts = []
        defn = _unescape_newlines(str(obj.get("definition", ""))).strip()
        if defn:
            parts.append(f"## 是什么\n\n{defn}\n")
        pts = obj.get("points") or []
        if isinstance(pts, list) and pts:
            bullets = "\n".join(
                f"- {_unescape_newlines(str(p)).strip()}"
                for p in pts
                if _unescape_newlines(str(p)).strip()
            )
            if bullets:
                parts.append(f"## 关键要点\n\n{bullets}\n")
        if not drop_examples:
            example = _unescape_newlines(str(obj.get("example", ""))).strip()
            if example and not _looks_like_code(example):
                parts.append(f"## 示例\n\n{example}\n")
        contrast = _unescape_newlines(str(obj.get("contrast", ""))).strip()
        if contrast and not (drop_examples and _looks_like_code(contrast)):
            parts.append(f"## 易混淆 / 对比\n\n{contrast}\n")
        refs = _unescape_newlines(str(obj.get("refs", ""))).strip()
        if refs:
            parts.append(f"## 参考资料\n\n{refs}\n")
        md = "\n".join(parts)[:6000] if parts else _unescape_newlines(raw.strip())[:6000]
        subject = _clean_subject(_unescape_newlines(str(obj.get("subject", ""))).strip(), fallback=("英文词汇" if is_english_word else "其他"))
        translation = _unescape_newlines(str(obj.get("translation", ""))).strip()
        pos = _clean_pos(_unescape_newlines(str(obj.get("pos", ""))).strip())
        return {"subject": subject, "translation": translation, "pos": pos, "markdown": md, "raw": raw}

    # Strict JSON.parse failed. The model occasionally emits a malformed
    # escape (e.g. an extra `\"` inside one points entry) that breaks the
    # whole payload. Fall back to per-field regex extraction so the user
    # still gets a usable Markdown card; if even that yields nothing,
    # surface the raw response inside a fenced code block so the broken
    # state is visibly broken instead of being mistaken for prose.
    extracted = _extract_expanded_fields_lenient(raw)
    if extracted:
        drop_examples = is_english_word
        parts = []
        defn = _unescape_newlines(extracted.get("definition", "")).strip()
        if defn:
            parts.append(f"## 是什么\n\n{defn}\n")
        pts = extracted.get("points") or []
        if isinstance(pts, list) and pts:
            bullets = "\n".join(
                f"- {_unescape_newlines(str(p)).strip()}"
                for p in pts
                if _unescape_newlines(str(p)).strip()
            )
            if bullets:
                parts.append(f"## 关键要点\n\n{bullets}\n")
        if not drop_examples:
            example = _unescape_newlines(extracted.get("example", "")).strip()
            if example and not _looks_like_code(example):
                parts.append(f"## 示例\n\n{example}\n")
        contrast = _unescape_newlines(extracted.get("contrast", "")).strip()
        if contrast and not (drop_examples and _looks_like_code(contrast)):
            parts.append(f"## 易混淆 / 对比\n\n{contrast}\n")
        refs = _unescape_newlines(extracted.get("refs", "")).strip()
        if refs:
            parts.append(f"## 参考资料\n\n{refs}\n")
        md_body = "\n".join(parts)
        if md_body:
            md = md_body[:6000]
        else:
            notice = "> AI 返回的格式无法解析，已按原文展示，请点击「重新生成」重试。\n\n"
            md = (notice + f"```\n{_unescape_newlines(raw.strip())[:6000]}\n```")[:6000]
        subject = _clean_subject(_unescape_newlines(extracted.get("subject", "")).strip(), fallback=("英文词汇" if is_english_word else "其他"))
        translation = _unescape_newlines(extracted.get("translation", "")).strip()
        pos = _clean_pos(_unescape_newlines(extracted.get("pos", "")).strip())
        return {"subject": subject, "translation": translation, "pos": pos, "markdown": md, "raw": raw}

    fence = re.search(r"```(?:markdown|md)?\s*([\s\S]*?)```", raw)
    if fence:
        md_body = _unescape_newlines(fence.group(1).strip())[:6000]
    else:
        notice = "> AI 返回的格式无法解析，已按原文展示，请点击「重新生成」重试。\n\n"
        md_body = (notice + f"```\n{_unescape_newlines(raw.strip())[:6000]}\n```")[:6000]
    md = md_body
    return {"subject": ("英文词汇" if is_english_word else "其他"), "translation": "", "pos": "", "markdown": md, "raw": raw}


# Allowlist of canonical subjects the writer knows how to route.
# Anything else falls back to "其他".
_CANONICAL_SUBJECTS = (
    "英文词汇", "数学", "物理", "化学", "生物", "历史",
    "地理", "政治", "语文", "经济", "哲学", "心理学", "计算机", "其他",
)


def _clean_subject(raw: str, fallback: str) -> str:
    if not raw:
        return fallback
    cleaned = re.sub(r"[\s　]+", "", raw)
    if not cleaned:
        return fallback
    # Exact match first
    for c in _CANONICAL_SUBJECTS:
        if cleaned == c or re.sub(r"[\s　]+", "", c) == cleaned:
            return c
    # Loose match: contains any canonical label
    for c in _CANONICAL_SUBJECTS:
        if c in cleaned or cleaned in c:
            return c
    return fallback


_POS_ALIASES = {
    "n": "n.", "noun": "n.", "名词": "n.",
    "v": "v.", "verb": "v.", "动词": "v.",
    "adj": "adj.", "adjective": "adj.", "形容词": "adj.",
    "adv": "adv.", "adverb": "adv.", "副词": "adv.",
    "prep": "prep.", "介词": "prep.",
    "conj": "conj.", "连词": "conj.",
    "pron": "pron.", "代词": "pron.",
    "num": "num.", "数词": "num.",
    "art": "art.", "冠词": "art.",
    "aux": "aux.", "助动词": "aux.",
    "interj": "interj.", "感叹词": "interj.",
}


def _clean_pos(raw: str) -> str:
    if not raw:
        return ""
    key = raw.strip().lower().rstrip(".")
    return _POS_ALIASES.get(key, raw.strip())


# ── Lenient JSON field extraction ───────────────────────────────────────────
# When the AI returns malformed JSON (e.g. an extra `\"` inside one points
# entry), `json.loads` rejects the whole payload and we'd otherwise render
# the raw JSON to the user as if it were prose. The helpers below recover
# individual known fields via regex so the user still sees a structured
# Markdown card.

_EXPANDED_STRING_FIELDS = (
    "subject", "translation", "pos", "definition",
    "example", "contrast", "refs",
)


def _unescape_lenient(s: str) -> str:
    """Apply common JSON-style escapes to a string that didn't go through
    json.loads. Walks one backslash + one char per pass so double-backslash
    sequences collapse correctly without double-un-escaping."""
    result = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            mapping = {
                "n": "\n", "t": "\t", "r": "\r",
                '"': '"', "\\": "\\", "/": "/",
                "b": "\b", "f": "\f",
            }
            if nxt in mapping:
                result.append(mapping[nxt])
                i += 2
                continue
            result.append(nxt)
            i += 2
            continue
        result.append(ch)
        i += 1
    return "".join(result)


def _strip_outer_json_quotes(s: str) -> str | None:
    if len(s) < 2 or not s.startswith('"') or not s.endswith('"'):
        return None
    return s[1:-1]


def _split_top_level_commas(s: str) -> list[str]:
    """Split a JSON array body on commas that aren't inside a quoted string.
    Honours backslash-escaped quotes so a stray escape doesn't prematurely
    split an entry. Each returned item keeps its surrounding quotes so
    `_strip_outer_json_quotes` can unwrap them uniformly with the
    regex-extracted string fields."""
    items: list[str] = []
    buf: list[str] = []
    in_string = False
    escape = False
    for ch in s:
        if escape:
            buf.append(ch)
            escape = False
            continue
        if ch == "\\" and in_string:
            buf.append(ch)
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            buf.append(ch)
            continue
        if ch == "," and not in_string:
            items.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    if buf:
        items.append("".join(buf))
    return items


def _extract_expanded_fields_lenient(raw: str) -> dict | None:
    """Best-effort per-field extraction when the full payload fails json.loads.
    Returns a dict shaped like the parsed object, or None when no field
    could be recovered."""
    # Limit the search to the first balanced JSON object so trailing prose
    # or a second payload doesn't confuse the regex.
    obj_match = re.search(r"\{[\s\S]*\}", raw)
    candidate = obj_match.group(0) if obj_match else raw

    out: dict = {}
    found = False
    for field in _EXPANDED_STRING_FIELDS:
        m = re.search(rf'"{re.escape(field)}"\s*:\s*"((?:\\.|[^"\\])*)"', candidate)
        if m:
            value = _unescape_lenient(m.group(1)).strip()
            if value:
                out[field] = value
                found = True
    arr_match = re.search(r'"points"\s*:\s*\[([\s\S]*?)\]', candidate)
    if arr_match:
        items = _split_top_level_commas(arr_match.group(1))
        points: list[str] = []
        for item in items:
            unquoted = _strip_outer_json_quotes(item.strip())
            if unquoted is None:
                continue
            v = _unescape_lenient(unquoted).strip()
            if v:
                points.append(v)
        if points:
            out["points"] = points
            found = True
    return out if found else None


# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        LOG.debug("%s - %s", self.address_string(), fmt % args)

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, code: int, body: str):
        b = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def _read_body(self) -> dict:
        length = self.headers.get("Content-Length", "")
        if length:
            try:
                n = int(length)
            except ValueError:
                raise ValueError("invalid Content-Length")
        else:
            n = 0
        if n > _MAX_BODY_SIZE:
            raise ValueError(f"body too large ({n} > {_MAX_BODY_SIZE})")
        if n == 0:
            return {}
        raw = self.rfile.read(n)
        if len(raw) != n:
            raise ValueError("incomplete read")
        return json.loads(raw.decode("utf-8"))

    def _require_auth(self) -> bool:
        received = self.headers.get("X-Worktable-Token", "")
        if _check_auth(received):
            return True
        self._send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(self.path)
        path = parsed.path

        # /health — always allowed, no token required, no token in response
        if path == "/health":
            try:
                return self._send_json(200, {
                    "ok": True,
                    "browserReady": _BROWSER_READY,
                    "browserError": _BROWSER_ERROR,
                    "uptimeSec": int(time.time() - _START_TIME),
                    "cacheSize": len(_CACHE),
                    "cacheMax": _CACHE_MAX,
                })
            except Exception as e:
                return self._send_json(500, {"ok": False, "error": str(e)})

        # /shutdown — always allowed (for local testing)
        if path == "/shutdown":
            LOG.info("shutdown requested")
            self._send_json(200, {"ok": True, "msg": "shutting down"})
            _SHUTDOWN_EVENT.set()
            threading.Thread(target=lambda: (time.sleep(0.5), sys.exit(0)), daemon=True).start()
            return

        # /ai/health — authenticated or not, never leaks token
        if path == "/ai/health":
            try:
                cfg = _load_ai_config()
                return self._send_json(200, {
                    "ok": True,
                    "baseUrl": cfg["baseUrl"],
                    "model": cfg["model"],
                })
            except Exception as e:
                return self._send_json(500, {"ok": False, "error": str(e)})

        # /fetch — requires auth if token is configured
        if path == "/fetch":
            if not self._require_auth():
                return
            url = (parse_qs(parsed.query).get("url", [None]) or [None])[0]
            if not url:
                return self._send_json(400, {"ok": False, "error": "missing ?url=..."})
            if len(url) > _MAX_URL_LENGTH:
                return self._send_json(400, {"ok": False, "error": "url too long"})
            if not (url.startswith("http://") or url.startswith("https://")):
                return self._send_json(400, {"ok": False, "error": "url must be http(s)://"})
            if not _is_url_safe(url):
                return self._send_json(400, {"ok": False, "error": "url points to reserved network"})
            cached = _cache_get(url)
            if cached:
                return self._send_json(200, {**cached, "cacheHit": True})
            cfg = _load_config()
            timeout = cfg.get("upstreamFetchTimeout", 30)
            try:
                t0 = time.time()
                result = _fetch(url, timeout)
                elapsed = int((time.time() - t0) * 1000)
                result["elapsedMs"] = elapsed
                _cache_put(url, result)
                return self._send_json(200, {**result, "cacheHit": False})
            except Exception as e:
                LOG.exception("fetch failed")
                return self._send_json(500, {"ok": False, "error": f"fetch failed: {e}"})

        # landing /
        if path in ("/", "/index.html"):
            html = (
                "<!doctype html><meta charset=utf-8><title>cloakfetch</title>"
                "<body style='font:14px -apple-system,sans-serif;padding:24px;'>"
                "<h2>cloakfetch proxy</h2>"
                "<p>Stealth-Chromium CORS proxy for Obsidian learning module.</p>"
                "<ul>"
                "<li><b>Endpoints:</b></li>"
                "<li>GET <code>/health</code> — JSON status</li>"
                "<li>GET <code>/fetch?url=&lt;URL&gt;</code> — JSON with title + html</li>"
                "<li>POST <code>/ai/questions</code> — generate quiz from text</li>"
                "<li>POST <code>/ai/extract</code> — extract key points</li>"
                "<li>POST <code>/ai/expand</code> — expand a knowledge point</li>"
                "<li>GET <code>/ai/health</code> — AI config (no token)</li>"
                "</ul></body>"
            )
            return self._send_html(200, html)

        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        from urllib.parse import urlparse
        parsed = urlparse(self.path)
        path = parsed.path

        # /ai/questions
        if path == "/ai/questions":
            if not self._require_auth():
                return
            try:
                body = self._read_body()
            except Exception as e:
                return self._send_json(400, {"ok": False, "error": f"bad request: {e}"})
            title = str(body.get("title", "")).strip()
            text = str(body.get("text", "")).strip()
            count = int(body.get("count", 3))
            count = max(1, min(3, count))
            if not text:
                return self._send_json(400, {"ok": False, "error": "missing 'text'"})
            try:
                t0 = time.time()
                questions = _generate_questions(title, text, count)
                elapsed = int((time.time() - t0) * 1000)
                cfg = _load_ai_config()
                return self._send_json(200, {
                    "ok": True,
                    "count": len(questions),
                    "questions": questions,
                    "elapsedMs": elapsed,
                    "model": cfg["model"],
                })
            except Exception as e:
                LOG.exception("AI question generation failed")
                return self._send_json(502, {"ok": False, "error": str(e)})

        # /ai/extract
        if path == "/ai/extract":
            if not self._require_auth():
                return
            try:
                body = self._read_body()
            except Exception as e:
                return self._send_json(400, {"ok": False, "error": f"bad request: {e}"})
            title = str(body.get("title", "")).strip()
            text = str(body.get("text", "")).strip()
            max_points = int(body.get("maxPoints", 8))
            max_points = max(2, min(10, max_points))
            if not text:
                return self._send_json(400, {"ok": False, "error": "missing 'text'"})
            try:
                t0 = time.time()
                key_points = _extract_keypoints(title, text, max_points)
                elapsed = int((time.time() - t0) * 1000)
                return self._send_json(200, {
                    "ok": True,
                    "count": len(key_points),
                    "keyPoints": key_points,
                    "elapsedMs": elapsed,
                })
            except Exception as e:
                LOG.exception("AI extract failed")
                return self._send_json(502, {"ok": False, "error": str(e)})

        # /ai/expand
        if path == "/ai/expand":
            if not self._require_auth():
                return
            try:
                body = self._read_body()
            except Exception as e:
                return self._send_json(400, {"ok": False, "error": f"bad request: {e}"})
            name = str(body.get("name", "")).strip()
            context = str(body.get("context", "")).strip()
            if not name:
                return self._send_json(400, {"ok": False, "error": "missing 'name'"})
            try:
                t0 = time.time()
                payload = _expand_knowledge_point(name, context)
                elapsed = int((time.time() - t0) * 1000)
                return self._send_json(200, {
                    "ok": True,
                    "subject": payload.get("subject", "其他"),
                    "translation": payload.get("translation", ""),
                    "pos": payload.get("pos", ""),
                    "markdown": payload.get("markdown", ""),
                    "elapsedMs": elapsed,
                })
            except Exception as e:
                LOG.exception("AI expand failed")
                return self._send_json(502, {"ok": False, "error": str(e)})

        self._send_json(404, {"ok": False, "error": "not found"})


# ── Graceful shutdown ─────────────────────────────────────────────────────────
def _graceful_shutdown(signum, frame):
    LOG.info("Signal %d — graceful shutdown", signum)
    _SHUTDOWN_EVENT.set()
    if _WORKER:
        _WORKER.stop()
    threading.Thread(target=lambda: (time.sleep(1), sys.exit(0)), daemon=True).start()


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="cloakfetch — CORS proxy backed by CloakBrowser")
    parser.add_argument("--host", default=None, help="bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=None, help="bind port (default 8765)")
    args = parser.parse_args()

    cfg = _load_config()
    host = args.host if args.host is not None else cfg.get("host", "127.0.0.1")
    port = args.port if args.port is not None else int(cfg.get("port", 8765))

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, _graceful_shutdown)
    signal.signal(signal.SIGINT, _graceful_shutdown)

    srv = ThreadingHTTPServer((host, port), Handler)
    LOG.info("cloakfetch listening on http://%s:%d", host, port)
    LOG.info("Try: curl 'http://%s:%d/health'", host, port)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        LOG.info("Shutting down...")
        srv.shutdown()
        try:
            srv.server_close()
        except Exception:
            pass
        if _BROWSER:
            try:
                _BROWSER.close()
            except Exception as e:
                LOG.warning("Browser close error: %s", e)
        LOG.info("CloakBrowser closed")


if __name__ == "__main__":
    main()
