import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

type DialogTimer = {
  current: ReturnType<typeof setTimeout> | undefined
}

type DialogState = {
  stack: () => Active[]
  setStack: (updater: (items: Active[]) => Active[]) => void
  timer: DialogTimer
  lock: { value: boolean }
}

function clearTimer(timer: DialogTimer) {
  if (timer.current === undefined) return
  clearTimeout(timer.current)
  timer.current = undefined
}

function getActiveDialog(items: Active[], id?: string) {
  return id ? items.find((item) => item.id === id) : items.at(-1)
}

function closeActive(item: Active, state: DialogState) {
  if (state.lock.value) return

  state.lock.value = true
  item.onClose?.()
  item.setClosing(true)

  const closed = item.id
  clearTimer(state.timer)

  state.timer.current = setTimeout(() => {
    state.timer.current = undefined
    item.dispose()
    state.setStack((items) => items.filter((dialog) => dialog.id !== closed))
    state.lock.value = false
  }, 100)
}

function createEscapeHandler(close: (id?: string) => void) {
  return (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    close()
    event.preventDefault()
    event.stopPropagation()
  }
}

function createDialogNode(
  element: DialogElement,
  owner: Owner,
  onClose: (() => void) | undefined,
  layer: number,
  close: (id?: string) => void,
) {
  const id = Math.random().toString(36).slice(2)
  const zIndex = 50 + layer * 10
  let dispose: (() => void) | undefined
  let setClosing: ((closing: boolean) => void) | undefined

  const node = runWithOwner(owner, () =>
    createRoot((d: () => void) => {
      dispose = d
      const [closing, setClosingSignal] = createSignal(false)
      setClosing = setClosingSignal
      return (
        <Kobalte
          modal
          open={!closing()}
          onOpenChange={(open: boolean) => {
            if (open) return
            close(id)
          }}
        >
          <Kobalte.Portal>
            <Kobalte.Overlay
              data-component="dialog-overlay"
              style={{ "z-index": String(zIndex) }}
              onClick={() => close(id)}
            />
            <div
              data-dialog-layer={layer}
              style={{
                position: "fixed",
                inset: "0",
                "z-index": String(zIndex),
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                "pointer-events": "none",
              }}
            >
              {element()}
            </div>
          </Kobalte.Portal>
        </Kobalte>
      )
    }),
  )

  if (!dispose || !setClosing) return

  return { id, node, dispose, owner, onClose, setClosing }
}

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  const timer: DialogTimer = { current: undefined }
  const lock = { value: false }

  onCleanup(() => {
    clearTimer(timer)
  })

  const close = (id?: string) => {
    const current = getActiveDialog(stack(), id)
    if (!current || lock.value) return
    closeActive(current, { stack, setStack, timer, lock })
  }

  createEffect(() => {
    if (stack().length === 0) return
    makeEventListener(window, "keydown", createEscapeHandler(close), { capture: true })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number) => {
    const active = createDialogNode(element, owner, onClose, layer, close)
    if (!active) return
    setStack((items) => [...items, active])
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    clearTimer(timer)
    lock.value = false
    mount(element, owner, onClose, stack().length)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    for (const item of stack()) item.dispose()
    setStack([])
    clearTimer(timer)
    lock.value = false
    mount(element, owner, onClose, 0)
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.stack().at(-1)
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.show(element, base, onClose))
    },
    push(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.push(element, base, onClose))
    },
    close() {
      ctx.close()
    },
  }
}
