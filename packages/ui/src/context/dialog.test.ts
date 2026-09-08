import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createComponent, type Component, type JSX } from "solid-js"
import { render } from "solid-js/web"

type ElementProps = Record<string, unknown> & { children?: unknown }

function appendChildren(element: Node, children: unknown[]) {
  for (const child of children.flat(Infinity)) {
    if (child instanceof Node) {
      element.appendChild(child)
      continue
    }
    if (child !== undefined && child !== null && child !== false) {
      element.appendChild(document.createTextNode(String(child)))
    }
  }
}

function createElement(type: unknown, props: ElementProps | null, ...children: unknown[]): JSX.Element {
  const attributes = props ?? {}
  const content = children.length > 0 ? children : [attributes.children]

  if (typeof type === "function") {
    const result: unknown = createComponent(type as Component<{ children: unknown }>, {
      ...attributes,
      children: content.length === 1 ? content[0] : content,
    })
    return (typeof result === "function" ? (result as () => unknown)() : result) as JSX.Element
  }

  const element = document.createElement(String(type))
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "children" || name === "ref" || value === undefined || value === false) continue
    if (name.startsWith("on") && typeof value === "function") {
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    element.setAttribute(name, String(value))
  }
  appendChildren(element, content)
  return element as unknown as JSX.Element
}

globalThis.React = { createElement } as unknown as typeof globalThis.React

let clickOverlay: (() => void) | undefined

mock.module("@kobalte/core/dialog", () => {
  const Dialog = (props: ElementProps) => props.children
  Dialog.Portal = (props: ElementProps) => props.children
  Dialog.Overlay = (props: ElementProps) => {
    clickOverlay = props.onClick as (() => void)
    return createElement("div", props)
  }
  return { Dialog }
})

const { DialogProvider, useDialog } = await import("./dialog")

function createDialogHost() {
  const host = document.createElement("div")
  document.body.append(host)
  return host
}

function TestApp(props: { onClose: () => void; onRender?: () => void }) {
  const dialog = useDialog()
  const button = document.createElement("button")
  button.textContent = "Open"
  button.addEventListener("click", () =>
    dialog.show(
      () => {
        props.onRender?.()
        return createElement("div", { "data-dialog": "first" }, "First dialog")
      },
      props.onClose,
    ),
  )

  return button
}

describe("DialogProvider", () => {
  beforeEach(() => {
    document.body.replaceChildren()
    clickOverlay = undefined
  })

  test("mounts dialogs and closes the active dialog with Escape", async () => {
    const host = createDialogHost()
    let closeCount = 0
    let renderCount = 0
    const dispose = render(
      () =>
        createComponent(DialogProvider, {
          children: (() => createComponent(TestApp, { onClose: () => closeCount++, onRender: () => renderCount++ })) as unknown as JSX.Element,
        }),
      host,
    )

    host.querySelector("button")?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderCount).toBe(1)

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(closeCount).toBe(1)
    expect(host.querySelector('[data-component="dialog-overlay"]')).toBeNull()
    dispose()
    host.remove()
  })

  test("closes a dialog when its overlay is clicked", async () => {
    const host = createDialogHost()
    const dispose = render(
      () =>
        createComponent(DialogProvider, {
          children: (() => createComponent(TestApp, { onClose: () => {} })) as unknown as JSX.Element,
        }),
      host,
    )

    host.querySelector("button")?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(clickOverlay).toBeDefined()
  clickOverlay?.()
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(host.querySelector('[data-dialog="first"]')).toBeNull()
    dispose()
    host.remove()
  })
})
