import {
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $applyNodeReplacement,
} from 'lexical'

export type SerializedSceneHeadingNode = Spread<
  { sceneNumber?: number },
  SerializedElementNode
>

export class SceneHeadingNode extends ElementNode {
  __sceneNumber?: number

  static getType(): string {
    return 'scene-heading'
  }

  static clone(node: SceneHeadingNode): SceneHeadingNode {
    return new SceneHeadingNode(node.__sceneNumber, node.__key)
  }

  constructor(sceneNumber?: number, key?: NodeKey) {
    super(key)
    this.__sceneNumber = sceneNumber
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.classList.add('screenplay-element', 'screenplay-scene-heading')
    return dom
  }

  updateDOM(): boolean {
    return false
  }

  static importJSON(json: SerializedSceneHeadingNode): SceneHeadingNode {
    return $createSceneHeadingNode(json.sceneNumber)
  }

  exportJSON(): SerializedSceneHeadingNode {
    return {
      ...super.exportJSON(),
      type: 'scene-heading',
      sceneNumber: this.__sceneNumber,
      version: 1,
    }
  }

  getSceneNumber(): number | undefined {
    return this.__sceneNumber
  }

  setSceneNumber(num: number | undefined): void {
    const writable = this.getWritable()
    writable.__sceneNumber = num
  }

  insertNewAfter(): ElementNode {
    const { $createActionNode } = require('./ActionNode')
    const node = $createActionNode()
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

export function $createSceneHeadingNode(sceneNumber?: number): SceneHeadingNode {
  return $applyNodeReplacement(new SceneHeadingNode(sceneNumber))
}

export function $isSceneHeadingNode(node: LexicalNode | null | undefined): node is SceneHeadingNode {
  return node instanceof SceneHeadingNode
}
