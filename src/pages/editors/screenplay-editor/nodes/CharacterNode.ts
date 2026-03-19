import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedCharacterNode = Spread<
  { dual?: boolean },
  SerializedElementNode
>

export class CharacterNode extends ElementNode {
  /** Whether this is part of dual dialogue */
  __dual: boolean

  static getType(): string {
    return 'character'
  }

  static clone(node: CharacterNode): CharacterNode {
    return new CharacterNode(node.__dual, node.__key)
  }

  constructor(dual?: boolean, key?: NodeKey) {
    super(key)
    this.__dual = dual ?? false
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-character')
    if (this.__dual) dom.classList.add('screenplay-dual')
    return dom
  }

  updateDOM(prevNode: CharacterNode): boolean {
    return prevNode.__dual !== this.__dual
  }

  static importJSON(json: SerializedCharacterNode): CharacterNode {
    return $createCharacterNode(json.dual)
  }

  exportJSON(): SerializedCharacterNode {
    return {
      ...super.exportJSON(),
      type: 'character',
      dual: this.__dual,
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
    const { $createActionNode } = require('./ActionNode')
    const node = $createActionNode()
    const children = this.getChildren()
    children.forEach((child: LexicalNode) => node.append(child))
    this.replace(node)
    return true
  }
}

export function $createCharacterNode(dual?: boolean): CharacterNode {
  return $applyNodeReplacement(new CharacterNode(dual))
}

export function $isCharacterNode(node: LexicalNode | null | undefined): node is CharacterNode {
  return node instanceof CharacterNode
}
