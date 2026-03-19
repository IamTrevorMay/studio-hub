import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedDialogueNode = SerializedElementNode

export class DialogueNode extends ElementNode {
  static getType(): string {
    return 'dialogue'
  }

  static clone(node: DialogueNode): DialogueNode {
    return new DialogueNode(node.__key)
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-dialogue')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(_json: SerializedDialogueNode): DialogueNode {
    return $createDialogueNode()
  }

  exportJSON(): SerializedDialogueNode {
    return {
      ...super.exportJSON(),
      type: 'dialogue',
      version: 1,
    }
  }

  insertNewAfter(): ElementNode {
    const { $createCharacterNode } = require('./CharacterNode')
    const node = $createCharacterNode()
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

export function $createDialogueNode(): DialogueNode {
  return $applyNodeReplacement(new DialogueNode())
}

export function $isDialogueNode(node: LexicalNode | null | undefined): node is DialogueNode {
  return node instanceof DialogueNode
}
