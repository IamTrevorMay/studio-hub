import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedTransitionNode = SerializedElementNode

export class TransitionNode extends ElementNode {
  static getType(): string {
    return 'transition'
  }

  static clone(node: TransitionNode): TransitionNode {
    return new TransitionNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-transition')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedTransitionNode): TransitionNode {
    return $createTransitionNode()
  }

  exportJSON(): SerializedTransitionNode {
    return {
      ...super.exportJSON(),
      type: 'transition',
      version: 1,
    }
  }

  insertNewAfter(): ElementNode {
    const { $createSceneHeadingNode } = require('./SceneHeadingNode')
    const node = $createSceneHeadingNode()
    this.insertAfter(node)
    return node
  }

  collapseAtStart(): boolean {
    const { $createActionNode } = require('./ActionNode')
    const node = $createActionNode()
    const children = this.getChildren()
    children.forEach((child: LexicalNode) => node.append(child))
    this.replace(node)
    return true
  }
}

export function $createTransitionNode(): TransitionNode {
  return $applyNodeReplacement(new TransitionNode())
}

export function $isTransitionNode(node: LexicalNode | null | undefined): node is TransitionNode {
  return node instanceof TransitionNode
}
