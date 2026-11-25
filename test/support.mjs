// Zero-dependency helpers for the generative tests: a seeded PRNG, an HTML
// tokenizer that follows the browser rules the compiled page relies on, and a
// small DOM good enough to run kit/runtime.js against real compiled output.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Default seed is fixed so runs are reproducible; override with IB_SEED=<n>.
export const BASE_SEED = Number.parseInt(process.env.IB_SEED ?? "20261125", 10);

export function makeRng(salt) {
  let h = BASE_SEED ^ 0x9e3779b9;
  for (const ch of salt) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  const next = mulberry32(h);
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

export function failMessage(salt, i, detail, sample) {
  return `seed=${BASE_SEED} salt=${salt} case=${i}: ${detail}\n--- sample ---\n${sample}\n--------------`;
}

// HTML character references the compiler may emit or authors may write.
const NAMED_REFS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return String(s).replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.hasOwn(NAMED_REFS, ref) ? NAMED_REFS[ref] : m;
  });
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// Tokenize HTML into { type: "start" | "end" | "text" | "comment", ... }.
// Attribute values are entity-decoded; raw-text elements end only at their
// matching close tag, like the HTML tokenizer.
export function tokenize(html) {
  const out = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text: decodeEntities(text) });
    text = "";
  };
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      flush();
      const end = html.indexOf("-->", i + 4);
      const stop = end === -1 ? html.length : end + 3;
      out.push({ type: "comment", text: html.slice(i + 4, end === -1 ? html.length : end) });
      i = stop;
      continue;
    }
    if (html.startsWith("<!", i)) {
      flush();
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 64));
    if (!m) {
      text += html[i++];
      continue;
    }
    flush();
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    let j = i + m[0].length;
    const attrs = [];
    while (j < html.length && html[j] !== ">") {
      if (/[\s/]/.test(html[j])) {
        j++;
        continue;
      }
      const am = /^([^\s"'>\/=]+)/.exec(html.slice(j));
      if (!am) {
        j++;
        continue;
      }
      const attrName = am[1].toLowerCase();
      j += am[1].length;
      while (/\s/.test(html[j] || "")) j++;
      let value = "";
      if (html[j] === "=") {
        j++;
        while (/\s/.test(html[j] || "")) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end === -1 ? html.length : end);
          j = end === -1 ? html.length : end + 1;
        } else {
          const vm = /^[^\s>]*/.exec(html.slice(j));
          value = vm[0];
          j += value.length;
        }
      }
      if (!attrs.some(([n]) => n === attrName)) attrs.push([attrName, decodeEntities(value)]);
    }
    i = j + 1;
    if (closing) {
      out.push({ type: "end", name });
      continue;
    }
    out.push({ type: "start", name, attrs });
    if (RAW_TEXT.has(name)) {
      const re = new RegExp(`</${name}[\\s/>]`, "i");
      const rest = html.slice(i);
      const em = re.exec(rest);
      const body = em ? rest.slice(0, em.index) : rest;
      const rawCode = name === "script" || name === "style";
      out.push({ type: "text", text: rawCode ? body : decodeEntities(body), raw: rawCode });
      i += body.length;
    }
  }
  flush();
  return out;
}

// --- Mini DOM --------------------------------------------------------------

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseSelector(sel) {
  return sel.split(",").map((part) =>
    part
      .trim()
      .split(/\s+/)
      .map((compound) => {
        const tests = [];
        const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w:-]+)(?:="([^"]*)")?\]/g;
        for (const [, tag, cls, attr, val] of compound.matchAll(re)) {
          if (tag) tests.push((el) => el.tagName.toLowerCase() === tag.toLowerCase());
          else if (cls) tests.push((el) => el.classList.contains(cls));
          else if (val !== undefined) tests.push((el) => el.getAttribute(attr) === val);
          else tests.push((el) => el.hasAttribute(attr));
        }
        return (el) => tests.every((t) => t(el));
      })
  );
}

function matchesChain(el, chain) {
  if (!chain[chain.length - 1](el)) return false;
  let idx = chain.length - 2;
  let cur = el.parentNode;
  while (idx >= 0 && cur && cur.nodeType === 1) {
    if (chain[idx](cur)) idx--;
    cur = cur.parentNode;
  }
  return idx < 0;
}

class ClassList {
  constructor(el) {
    this.el = el;
  }
  get set() {
    return new Set((this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean));
  }
  write(set) {
    this.el.setAttribute("class", Array.from(set).join(" "));
  }
  contains(c) {
    return this.set.has(c);
  }
  add(...cs) {
    const s = this.set;
    cs.forEach((c) => s.add(c));
    this.write(s);
  }
  remove(...cs) {
    const s = this.set;
    cs.forEach((c) => s.delete(c));
    this.write(s);
  }
  toggle(c, force) {
    const s = this.set;
    const on = force === undefined ? !s.has(c) : Boolean(force);
    if (on) s.add(c);
    else s.delete(c);
    this.write(s);
    return on;
  }
}

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.data = text;
    this.parentNode = null;
  }
  get textContent() {
    return this.data;
  }
}

const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export class Element {
  constructor(tagName, attrs = [], doc = null) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(attrs);
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.ownerDocument = doc;
    this.classList = new ClassList(this);
    this.value = this.attributes.get("value") ?? "";
    this.open = this.attributes.has("open");
    this.style = {};
    const self = this;
    this.dataset = new Proxy(
      {},
      {
        get: (_, key) => {
          for (const [n, v] of self.attributes) if (n.startsWith("data-") && camel(n.slice(5)) === key) return v;
          return undefined;
        },
      }
    );
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  getAttribute(n) {
    return this.attributes.has(n) ? this.attributes.get(n) : null;
  }
  setAttribute(n, v) {
    this.attributes.set(n, String(v));
    if (n === "open") this.open = true;
  }
  removeAttribute(n) {
    this.attributes.delete(n);
    if (n === "open") this.open = false;
  }
  hasAttribute(n) {
    return this.attributes.has(n);
  }
  get hidden() {
    return this.attributes.has("hidden");
  }
  set hidden(v) {
    if (v) this.attributes.set("hidden", "");
    else this.attributes.delete("hidden");
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get src() {
    return this.getAttribute("src") || "";
  }
  set src(v) {
    this.setAttribute("src", v);
  }
  get alt() {
    return this.getAttribute("alt") || "";
  }
  set alt(v) {
    this.setAttribute("alt", v);
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((n) => n !== node);
    node.parentNode = null;
    return node;
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v) {
    this.childNodes.forEach((n) => (n.parentNode = null));
    this.childNodes = [];
    if (String(v)) this.appendChild(new TextNode(String(v)));
  }
  get innerHTML() {
    const ser = (n) => {
      if (n.nodeType === 3) return escText(n.data);
      const attrs = Array.from(n.attributes, ([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
      const tag = n.tagName.toLowerCase();
      if (VOID.has(tag)) return `<${tag}${attrs}>`;
      return `<${tag}${attrs}>${n.childNodes.map(ser).join("")}</${tag}>`;
    };
    return this.childNodes.map(ser).join("");
  }
  set innerHTML(html) {
    this.childNodes.forEach((n) => (n.parentNode = null));
    this.childNodes = [];
    buildInto(this, tokenize(String(html)), this.ownerDocument);
  }
  matches(sel) {
    return parseSelector(sel).some((chain) => matchesChain(this, chain));
  }
  closest(sel) {
    const chains = parseSelector(sel);
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (chains.some((chain) => matchesChain(cur, chain))) return cur;
      cur = cur.parentNode;
    }
    return null;
  }
  querySelectorAll(sel) {
    const chains = parseSelector(sel);
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (chains.some((chain) => matchesChain(c, chain))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  showModal() {
    this.open = true;
    this.attributes.set("open", "");
  }
  close() {
    this.open = false;
    this.attributes.delete("open");
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  select() {
    this.selected = true;
  }
}

function buildInto(parent, tokens, doc) {
  const stack = [parent];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === "text") top.appendChild(new TextNode(t.text));
    else if (t.type === "start") {
      const el = new Element(t.name, t.attrs, doc);
      top.appendChild(el);
      if (!VOID.has(t.name)) stack.push(el);
    } else if (t.type === "end") {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tagName.toLowerCase() === t.name) {
          stack.length = k;
          break;
        }
      }
    }
  }
}

// Build a document from compiled HTML and run kit/runtime.js inside it.
// Returns helpers to dispatch bubbling events and inspect the page.
export function loadPage(html, vm) {
  const doc = {
    listeners: {},
    activeElement: null,
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    createElement: (tag) => new Element(tag, [], doc),
    execCommand: () => false,
  };
  const root = new Element("html", [], doc);
  buildInto(root, tokenize(html), doc);
  const body = root.querySelector("body");
  doc.body = body;
  doc.querySelectorAll = (sel) => root.querySelectorAll(sel);
  doc.querySelector = (sel) => root.querySelector(sel);

  const timers = new Map();
  let nextTimer = 1;
  const clipboard = [];
  const scripts = root.querySelectorAll("script").map((s) => s.textContent);
  const env = {
    document: doc,
    navigator: { clipboard: { writeText: async (t) => void clipboard.push(t) } },
    setInterval: (fn) => {
      const id = nextTimer++;
      timers.set(id, { fn, repeat: true });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (fn) => {
      const id = nextTimer++;
      timers.set(id, { fn, repeat: false });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  for (const js of scripts) vm.runInNewContext(js, env);

  async function dispatch(target, type, extra = {}) {
    const ev = { type, target, relatedTarget: null, key: undefined, preventDefault() {}, ...extra };
    const pending = [];
    for (let n = target; n; n = n.parentNode) {
      for (const fn of n.listeners?.[type] || []) pending.push(fn(ev));
    }
    for (const fn of doc.listeners[type] || []) pending.push(fn(ev));
    await Promise.all(pending);
  }

  return {
    doc,
    root,
    body,
    clipboard,
    intervals: () => Array.from(timers.entries()).filter(([, t]) => t.repeat),
    fireInterval: (id) => timers.get(id)?.fn(),
    dispatch,
    click: (el) => dispatch(el, "click"),
    hover: (el) => dispatch(el, "mouseover"),
    leave: (el, to = body) => dispatch(el, "mouseout", { relatedTarget: to }),
    lit: () => root.querySelectorAll("[data-focus]").filter((e) => e.classList.contains("ib-lit")),
    dim: () => root.querySelectorAll("[data-focus]").filter((e) => e.classList.contains("ib-dim")),
  };
}
