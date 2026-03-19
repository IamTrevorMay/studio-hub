import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedParentheticalNode = SerializedElementNode

export class ParentheticalNode extends ElementNode {
  static getType(): string {
    return 'parenthetical'
  }

  static clone(node: ParentheticalNode): ParentheticalNode {
    return new ParentheticalNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-parenthetical')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedParentheticalNode): ParentheticalNode {
    return $createParentheticalNode()
  }

  exportJSON(): SerializedParentheticalNode {
    return {
      ...super.exportJSON(),
      type: 'parenthetical',
      version: 1,
    }
  }

  insertNewAfter(): ElementNode {
    const { $createDialogueNode } = require('./DialogueNode')
    const node = $createDialogueNode()
    this.insertAfter(node)
    return node
  }

  collapseAtStart(): boolean {
    const { $createDialogueNode } = require('./DialogueNode')
    const node = $createDialogueNode()
    const children = this.getChildren()
    children.forEach((child: LexicalNode) => node.append(child))
    this.replace(node)
    return true
  }
}

export function $createParentheticalNode(): ParentheticalNode {
  return $applyNodeReplacement(new ParentheticalNode())
}

export function $isParentheticalNode(node: LexicalNode | null | undefined): node is ParentheticalNode {
  return node instanceof ParentheticalNode
}
