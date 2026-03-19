export { SceneHeadingNode, $createSceneHeadingNode, $isSceneHeadingNode } from './SceneHeadingNode'
export type { SerializedSceneHeadingNode } from './SceneHeadingNode'

export { ActionNode, $createActionNode, $isActionNode } from './ActionNode'
export type { SerializedActionNode } from './ActionNode'

export { CharacterNode, $createCharacterNode, $isCharacterNode } from './CharacterNode'
export type { SerializedCharacterNode } from './CharacterNode'

export { DialogueNode, $createDialogueNode, $isDialogueNode } from './DialogueNode'
export type { SerializedDialogueNode } from './DialogueNode'

export { ParentheticalNode, $createParentheticalNode, $isParentheticalNode } from './ParentheticalNode'
export type { SerializedParentheticalNode } from './ParentheticalNode'

export { TransitionNode, $createTransitionNode, $isTransitionNode } from './TransitionNode'
export type { SerializedTransitionNode } from './TransitionNode'

export { NoteMarkNode, $createNoteMarkNode, $isNoteMarkNode } from './NoteMarkNode'
export type { SerializedNoteMarkNode, NoteColor } from './NoteMarkNode'

import { type Klass, type LexicalNode } from 'lexical'
import { SceneHeadingNode } from './SceneHeadingNode'
import { ActionNode } from './ActionNode'
import { CharacterNode } from './CharacterNode'
import { DialogueNode } from './DialogueNode'
import { ParentheticalNode } from './ParentheticalNode'
import { TransitionNode } from './TransitionNode'
import { NoteMarkNode } from './NoteMarkNode'

export const ScreenplayNodes: Array<Klass<LexicalNode>> = [
  SceneHeadingNode,
  ActionNode,
  CharacterNode,
  DialogueNode,
  ParentheticalNode,
  TransitionNode,
  NoteMarkNode,
]
