import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedActionNode = SerializedElementNode

export class ActionNode extends ElementNode {
  static getType(): string {
    return 'action'
  }

  static clone(node: ActionNode): ActionNode {
    return new ActionNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-action')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedActionNode): ActionNode {
    return $createActionNode()
  }

  exportJSON(): SerializedActionNode {
    return {
      ...super.exportJSON(),
      type: 'action',
      version: 1,
    }
  }

  insertNewAfter(): ElementNode {
    const node = $createActionNode()
    this.insertAfter(node)
    return node
  }

  collapseAtStart(): boolean {
    return false
  }
}

export function $createActionNode(): ActionNode {
  return $applyNodeReplacement(new ActionNode())
}

export function $isActionNode(node: LexicalNode | null | undefined): node is ActionNode {
  return node instanceof ActionNode
}
