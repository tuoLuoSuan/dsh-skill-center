/**
 * A ~150 line stand-in for React, plus two serializers.
 *
 * The plugin's browser bundle is a classic script that only ever calls
 * `require('react')`, so a stub is enough to run it headlessly:
 *
 *   - `render(element)`  -> React-flavoured markup (`className=…`) plus a flat
 *                           list of `{ type, props }` nodes. Tests walk the
 *                           nodes and invoke `props.onClick` to drive the UI.
 *   - `renderHtml(element)` -> real HTML (`class=…`, `style="…"`), used by
 *                           `docs/preview.mjs` to screenshot the panel.
 *
 * Hooks are approximated: `useState` hands back the initial value with a no-op
 * setter, `useSyncExternalStore` calls the snapshot getter, and `useEffect`
 * callbacks are queued and run once the subtree has rendered. State therefore
 * lives in the component's external store, which is exactly how the plugin is
 * written — mutate the store, re-render, see the new output.
 */

export const Fragment = Symbol('Fragment')

let frame = null

const flatten = (value, out = []) => {
  if (Array.isArray(value)) for (const item of value) flatten(item, out)
  else if (value !== null && value !== undefined && value !== false && value !== true) out.push(value)
  return out
}

export const React = {
  Fragment,
  createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    const kids = flatten(children)
    if (kids.length > 0) merged.children = kids.length === 1 ? kids[0] : kids
    return { type, props: merged }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  useEffect(fn) {
    if (frame === null) throw new Error('useEffect called outside of a render')
    frame.effects.push(fn)
  },
}

const pendingEffects = []
const cleanups = []

const escapeText = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttr = (value) => escapeText(value).replace(/"/g, '&quot;')

/** Turn a React prop bag into an HTML attribute string. */
const attributesHtml = (props) => {
  const parts = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key' || key === 'ref') continue
    if (value === null || value === undefined || value === false) continue
    if (typeof value === 'function') continue
    if (key === 'dangerouslySetInnerHTML') continue
    if (key === 'style' && typeof value === 'object') {
      const css = Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([p, v]) => `${p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
        .join(';')
      if (css !== '') parts.push(` style="${escapeAttr(css)}"`)
      continue
    }
    const name = key === 'className' ? 'class' : key
    if (value === true) parts.push(` ${name}`)
    else parts.push(` ${name}="${escapeAttr(value)}"`)
  }
  return parts.join('')
}

/** React-flavoured attribute string — the probe format the smoke test reads. */
const attributesProbe = (props) =>
  Object.entries(props)
    .filter(([key]) => key !== 'children')
    .map(([key, value]) => ` ${key}=${JSON.stringify(typeof value === 'function' ? '[fn]' : value)}`)
    .join('')

const walk = (node, depth, format) => {
  if (node === null || node === undefined || node === false || node === true) return { html: '', nodes: [] }
  if (typeof node === 'string' || typeof node === 'number') {
    return { html: format === 'html' ? escapeText(node) : String(node), nodes: [] }
  }
  if (Array.isArray(node)) {
    const parts = node.map((child) => walk(child, depth, format))
    return { html: parts.map((part) => part.html).join(''), nodes: parts.flatMap((part) => part.nodes) }
  }
  if (depth > 80) throw new Error('render recursion exceeded 80 levels')
  if (node.props === undefined) {
    throw new Error(`element without props: keys=${JSON.stringify(Object.keys(node))} type=${String(node.type)}`)
  }
  const { type, props } = node
  if (typeof type === 'function') {
    const previous = frame
    const local = { effects: [] }
    frame = local
    let output
    try {
      output = type(props)
    } finally {
      frame = previous
    }
    const inner = walk(output, depth + 1, format)
    // Component effects commit after their subtree, the way React does.
    if (previous !== null) previous.effects.push(...local.effects)
    else pendingEffects.push(...local.effects)
    return inner
  }
  if (type === Fragment) return walk(props.children, depth + 1, format)
  const attributes = format === 'html' ? attributesHtml(props) : attributesProbe(props)
  const inner = walk(props.children, depth + 1, format)
  return {
    html: `<${String(type)}${attributes}>${inner.html}</${String(type)}>`,
    nodes: [{ type: String(type), props }, ...inner.nodes],
  }
}

const commit = () => {
  const effects = pendingEffects.splice(0, pendingEffects.length)
  for (const effect of effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
}

/** Render and flush effects; returns `{ html, nodes }` in probe format. */
export const mount = (element) => {
  pendingEffects.length = 0
  const tree = walk(element, 0, 'probe')
  commit()
  return tree
}

/** Render to valid HTML. Effects are flushed too, so `boot()` requests fire. */
export const renderHtml = (element) => {
  pendingEffects.length = 0
  const tree = walk(element, 0, 'html')
  commit()
  return tree.html
}

/** Unmount bookkeeping for tests: runs everything `useEffect` returned. */
export const runCleanups = () => {
  const pending = cleanups.splice(0, cleanups.length)
  for (const cleanup of pending) cleanup()
  return pending.length
}

export const find = (tree, predicate) => tree.nodes.find(predicate)

// Buttons label themselves with mixed children (`[<Icon/>, t('search')]`), so a
// strict `children === label` test misses most of them; flatten to text first.
export const textOf = (value) => {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value === 'object') return textOf(value.props?.children)
  return String(value)
}

export const findButton = (tree, label) =>
  find(tree, (node) => node.type === 'button' && (label === undefined || textOf(node.props.children).includes(label)))

export const buttonWithClass = (tree, klass) =>
  find(tree, (node) => node.type === 'button' && String(node.props.className ?? '').includes(klass))
