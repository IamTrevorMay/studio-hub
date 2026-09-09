import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { editorExtensions } from '../editor/extensions'
import { useAutoSave } from '../hooks/useAutoSave'
import {
  getEffectivePageDimensions,
  getMarginsInPx,
  useEditorStore,
} from '../editorStore'
import { supabase } from '../../../../supabaseClient'
import { useAuth } from '../../../../contexts/AuthContext'
import {
  buildHtmlDocument,
  downloadFile,
  jsonToMarkdown,
  sanitizeFilename,
} from '../ExportMenu'
import LinkBubble from '../LinkBubble'
import TableControls from '../TableControls'
import EditorContextMenu from '../EditorContextMenu'
import FindReplace from '../FindReplace'
import CommentPanel from '../CommentPanel'
import CommandPalette from '../CommandPalette'
import ImageInsertDialog from '../dialogs/ImageInsertDialog'
import TableInsertDialog from '../dialogs/TableInsertDialog'
import LinkInsertDialog from '../dialogs/LinkInsertDialog'
import EmojiPicker from '../dialogs/EmojiPicker'
import PageSetupPanel from '../dialogs/PageSetupPanel'
import SettingsModal from '../dialogs/SettingsModal'
import { Menu, MenuBar, MenuDivider, MenuItem, SubMenu } from './menu'
import GDocsToolbar from './GDocsToolbar'
import OutlinePane, { OutlineRailStub } from './OutlinePane'
import TemplateGallery from './TemplateGallery'
import type { ResearchTemplate, TemplateTag } from './TemplateGallery'
import { Check, Loader2, MessageSquare } from 'lucide-react'
import '../doc-editor.css'

const TEMPLATE_TABLE = 'research_doc_templates'
const ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200]

type DialogId = 'image' | 'table' | 'link' | 'emoji' | 'pageSetup' | 'settings' | null

// Tiptap serializes an untouched document as a single empty paragraph, so
// "empty" has to be checked through the doc rather than the HTML string.
function isDocEmpty(html: string | null | undefined) {
  if (!html) return true
  return html.replace(/<[^>]*>/g, '').trim().length === 0 && !/<(img|table|hr)\b/i.test(html)
}

interface Props {
  docId: string
  tableName: string
  /** Beat sheet title — the doc is named after the sheet it belongs to. */
  title: string
  initialSummary: string
  /** Admins can add, rename, and delete entries in the template gallery. */
  canManageTemplates: boolean
  /** Split view: start with the outline rail collapsed to buy back width. */
  compact?: boolean
}

export default function GDocsEditor({
  docId,
  tableName,
  title,
  initialSummary,
  canManageTemplates,
  compact = false,
}: Props) {
  const { profile } = useAuth() as any
  const {
    zoom, setZoom, pageSetup, setPageSetup,
    authorName, setAuthorName, isSaving, lastSavedAt,
  } = useEditorStore()

  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const [loaded, setLoaded] = useState(false)
  const [dialog, setDialog] = useState<DialogId>(null)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showOutline, setShowOutline] = useState(!compact)
  const [showGallery, setShowGallery] = useState(false)

  const [summary, setSummary] = useState(initialSummary || '')
  const [templates, setTemplates] = useState<ResearchTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)

  const editor = useEditor({
    extensions: editorExtensions,
    editorProps: { attributes: { class: 'tiptap prose-editor' } },
  })

  useEffect(() => {
    if (profile?.full_name) setAuthorName(profile.full_name)
  }, [profile?.full_name, setAuthorName])

  useEffect(() => { setSummary(initialSummary || '') }, [initialSummary, docId])

  // ── load ──────────────────────────────────────────────────────────────────
  // Mirrors DocEditor: reset `loaded` first and always setContent, so a slow
  // fetch for a previous doc can't land under a newer docId and get autosaved
  // over it.
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    setLoaded(false)
    ;(async () => {
      const { data } = await supabase
        .from(tableName)
        .select('content')
        .eq('id', docId)
        .single()
      if (cancelled || editor.isDestroyed) return
      const html = data?.content?.html || ''
      editor.commands.setContent(html)
      setLoaded(true)
      // A brand new doc opens on the gallery — that is the "pick a template or
      // start from scratch" moment, and it only happens while it is still empty.
      if (isDocEmpty(html)) setShowGallery(true)
    })()
    return () => { cancelled = true }
  }, [docId, editor, tableName])

  const flushSave = useAutoSave(editor, docId, tableName, loaded)

  // ── templates ─────────────────────────────────────────────────────────────
  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    const { data, error } = await supabase
      .from(TEMPLATE_TABLE)
      .select('id, name, description, content, position, tag')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) console.error('Fetch research templates failed:', error.message)
    setTemplates((data as ResearchTemplate[]) || [])
    setTemplatesLoading(false)
  }, [])

  useEffect(() => { if (showGallery) fetchTemplates() }, [showGallery, fetchTemplates])

  const applyTemplate = async (tpl: ResearchTemplate | null) => {
    if (!editor) return
    setShowGallery(false)
    editor.commands.setContent(tpl?.content?.html || '')
    editor.commands.focus('end')
    const { error } = await supabase
      .from(tableName)
      .update({ template_id: tpl?.id ?? null })
      .eq('id', docId)
    if (error) console.error('Template stamp failed:', error.message)
  }

  const saveCurrentAsTemplate = async () => {
    if (!editor) return
    const name = prompt('Template name:')?.trim()
    if (!name) return
    const description = prompt('Short description (optional):')?.trim() || null
    const { error } = await supabase.from(TEMPLATE_TABLE).insert({
      name,
      description,
      content: { html: editor.getHTML() },
      position: (templates[templates.length - 1]?.position ?? 0) + 10,
      created_by: profile?.id ?? null,
    })
    if (error) {
      console.error('Save research template failed:', error.message)
      alert(`Could not save template: ${error.message}`)
      return
    }
    fetchTemplates()
  }

  const renameTemplate = async (tpl: ResearchTemplate) => {
    const name = prompt('Template name:', tpl.name)?.trim()
    if (!name || name === tpl.name) return
    const { error } = await supabase
      .from(TEMPLATE_TABLE)
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', tpl.id)
    if (error) { console.error('Rename template failed:', error.message); return }
    fetchTemplates()
  }

  const setTemplateTag = async (tpl: ResearchTemplate, tag: TemplateTag) => {
    const { error } = await supabase
      .from(TEMPLATE_TABLE)
      .update({ tag, updated_at: new Date().toISOString() })
      .eq('id', tpl.id)
    if (error) { console.error('Set template tag failed:', error.message); return }
    fetchTemplates()
  }

  const deleteTemplate = async (tpl: ResearchTemplate) => {
    if (!window.confirm(`Delete the "${tpl.name}" template? Documents made from it are not affected.`)) return
    const { error } = await supabase.from(TEMPLATE_TABLE).delete().eq('id', tpl.id)
    if (error) { console.error('Delete template failed:', error.message); return }
    fetchTemplates()
  }

  // ── summary ───────────────────────────────────────────────────────────────
  const saveSummary = async (value: string) => {
    setSummary(value)
    const { error } = await supabase
      .from(tableName)
      .update({ summary: value || null, updated_at: new Date().toISOString() })
      .eq('id', docId)
    if (error) console.error('Summary save failed:', error.message)
  }

  // ── comments ──────────────────────────────────────────────────────────────
  const addComment = useCallback(() => {
    if (!editor || editor.state.selection.empty) return
    const text = prompt('Add a comment:')
    if (!text?.trim()) return
    editor.chain().focus().setMark('comment', {
      commentId: crypto.randomUUID(),
      author: authorName,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    }).run()
    setShowComments(true)
  }, [editor, authorName])

  const commentCount = (() => {
    if (!editor) return 0
    const ids = new Set<string>()
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'comment' && mark.attrs.commentId) ids.add(mark.attrs.commentId)
      })
    })
    return ids.size
  })()

  // ── export ────────────────────────────────────────────────────────────────
  const filename = sanitizeFilename(title)
  const exportAs = (kind: 'txt' | 'html' | 'md') => {
    if (!editor) return
    if (kind === 'txt') downloadFile(`${filename}.txt`, editor.getText(), 'text/plain')
    else if (kind === 'html') downloadFile(`${filename}.html`, buildHtmlDocument(title, editor.getHTML()), 'text/html')
    else downloadFile(`${filename}.md`, jsonToMarkdown(editor.getJSON() as Record<string, unknown>), 'text/markdown')
  }

  // ── shortcuts ─────────────────────────────────────────────────────────────
  // Scoped to this pane. In Split view the beat sheet's own inputs sit in the
  // same document, and a global ⌘F there should not open the doc's find bar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return

      if (e.key === 'f') { e.preventDefault(); setShowFindReplace(true) }
      else if (e.key === 'k') { e.preventDefault(); setDialog('link') }
      else if (e.key === '/') { e.preventDefault(); setShowPalette((v) => !v) }
      else if (e.key === 's') { e.preventDefault(); flushSave() }
      else if (e.key === ',') { e.preventDefault(); setDialog('settings') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flushSave])

  if (!editor) return null

  const pageDim = getEffectivePageDimensions(pageSetup)
  const marginsPx = getMarginsInPx(pageSetup.margins)
  const scale = zoom / 100
  const wordCount = editor.storage.characterCount?.words() ?? 0
  const charCount = editor.storage.characterCount?.characters() ?? 0

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0 bg-navy-950 gdocs-root">
      {/* ── Menu bar ── */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-navy-900 border-b border-navy-800 flex-shrink-0">
        <span className="text-[13px] font-semibold text-white truncate max-w-[220px]" title={title}>
          {title || 'Untitled'}
        </span>

        <MenuBar>
          <Menu id="file" label="File">
            <MenuItem label="New from template…" onClick={() => setShowGallery(true)} />
            <MenuItem label="Save now" shortcut="⌘S" onClick={() => flushSave()} />
            <MenuDivider />
            <SubMenu label="Download">
              <MenuItem label="Plain text (.txt)" onClick={() => exportAs('txt')} />
              <MenuItem label="Web page (.html)" onClick={() => exportAs('html')} />
              <MenuItem label="Markdown (.md)" onClick={() => exportAs('md')} />
            </SubMenu>
            <MenuItem label="Print" shortcut="⌘P" onClick={() => window.print()} />
            <MenuDivider />
            <MenuItem label="Page setup…" onClick={() => setDialog('pageSetup')} />
            {canManageTemplates && (
              <MenuItem label="Save as template…" onClick={saveCurrentAsTemplate} />
            )}
          </Menu>

          <Menu id="edit" label="Edit">
            <MenuItem label="Undo" shortcut="⌘Z" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
            <MenuItem label="Redo" shortcut="⇧⌘Z" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
            <MenuDivider />
            <MenuItem label="Select all" shortcut="⌘A" onClick={() => editor.chain().focus().selectAll().run()} />
            <MenuItem label="Find and replace" shortcut="⌘F" onClick={() => setShowFindReplace(true)} />
            <MenuDivider />
            <MenuItem label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
          </Menu>

          <Menu id="view" label="View">
            <MenuItem label="Show outline" checked={showOutline} keepOpen onClick={() => setShowOutline((v) => !v)} />
            <MenuItem label="Show comments" checked={showComments} keepOpen onClick={() => setShowComments((v) => !v)} />
            <MenuItem
              label="Show page breaks"
              checked={pageSetup.showPageBreaks}
              keepOpen
              onClick={() => setPageSetup({ showPageBreaks: !pageSetup.showPageBreaks })}
            />
            <MenuDivider />
            <SubMenu label="Zoom" width={140}>
              {ZOOM_LEVELS.map((z) => (
                <MenuItem key={z} label={`${z}%`} checked={zoom === z} onClick={() => setZoom(z)} />
              ))}
            </SubMenu>
          </Menu>

          <Menu id="insert" label="Insert">
            <MenuItem label="Image…" onClick={() => setDialog('image')} />
            <MenuItem label="Table…" onClick={() => setDialog('table')} />
            <MenuItem label="Link…" shortcut="⌘K" onClick={() => setDialog('link')} />
            <MenuItem label="Emoji…" onClick={() => setDialog('emoji')} />
            <MenuDivider />
            <MenuItem label="Horizontal line" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
            <MenuItem label="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
            <MenuItem label="Comment" disabled={editor.state.selection.empty} onClick={addComment} />
          </Menu>

          <Menu id="format" label="Format">
            <MenuItem label="Bold" shortcut="⌘B" checked={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
            <MenuItem label="Italic" shortcut="⌘I" checked={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
            <MenuItem label="Underline" shortcut="⌘U" checked={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
            <MenuItem label="Strikethrough" checked={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
            <MenuDivider />
            <MenuItem label="Superscript" checked={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
            <MenuItem label="Subscript" checked={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
            <MenuItem label="Block quote" checked={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
            <MenuDivider />
            <SubMenu label="Bullets & numbering">
              <MenuItem label="Checklist" checked={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} />
              <MenuItem label="Bulleted list" checked={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
              <MenuItem label="Numbered list" checked={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
            </SubMenu>
            <SubMenu label="Align">
              <MenuItem label="Left" checked={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
              <MenuItem label="Center" checked={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
              <MenuItem label="Right" checked={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
              <MenuItem label="Justify" checked={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />
            </SubMenu>
            <MenuDivider />
            <MenuItem label="Page setup…" onClick={() => setDialog('pageSetup')} />
          </Menu>

          <Menu id="tools" label="Tools">
            <MenuItem label={`Word count: ${wordCount}`} onClick={() => {}} />
            <MenuItem label="Comments" checked={showComments} keepOpen onClick={() => setShowComments((v) => !v)} />
            <MenuItem label="Command palette" shortcut="⌘/" onClick={() => setShowPalette(true)} />
            <MenuDivider />
            <MenuItem label="Document settings…" shortcut="⌘," onClick={() => setDialog('settings')} />
          </Menu>
        </MenuBar>

        {/* Save state — Docs puts this right of the menus */}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-navy-400 flex-shrink-0">
          {isSaving ? (
            <><Loader2 size={12} className="animate-spin" /> Saving…</>
          ) : lastSavedAt ? (
            <><Check size={12} className="text-emerald-400" /> Saved</>
          ) : null}
        </span>

        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          title="Toggle comments"
          className={`flex items-center gap-1.5 px-2 py-1 text-[12px] rounded transition-colors cursor-pointer flex-shrink-0 ${
            showComments ? 'bg-navy-700 text-white' : 'text-navy-400 hover:text-white hover:bg-navy-800'
          }`}
        >
          <MessageSquare size={13} />
          {commentCount > 0 && (
            <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
              {commentCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0">
        <GDocsToolbar
          editor={editor}
          onAddComment={addComment}
          onInsertImage={() => setDialog('image')}
          onInsertLink={() => setDialog('link')}
        />
      </div>

      {/* ── Outline + canvas + comments ── */}
      <div className="flex-1 flex min-h-0 relative">
        {showOutline
          ? <OutlinePane editor={editor} summary={summary} onSummaryChange={saveSummary} onClose={() => setShowOutline(false)} />
          : <OutlineRailStub onOpen={() => setShowOutline(true)} />}

        <div ref={canvasRef} className="relative flex-1 overflow-auto bg-navy-950 py-8 px-4">
          {editor.isActive('table') && (
            <div className="sticky top-0 z-40 flex justify-center mb-2">
              <TableControls editor={editor} />
            </div>
          )}

          <div
            className="mx-auto transition-transform duration-150"
            style={{ width: pageDim.width, transform: `scale(${scale})`, transformOrigin: 'top center' }}
          >
            <div
              className="page-canvas rounded shadow-lg shadow-black/30"
              style={{
                width: pageDim.width,
                minHeight: pageDim.height,
                paddingTop: marginsPx.top,
                paddingRight: marginsPx.right,
                paddingBottom: marginsPx.bottom,
                paddingLeft: marginsPx.left,
              }}
            >
              <EditorContent editor={editor} />
            </div>

            {pageSetup.showPageBreaks && (
              <div className="page-break-indicator">
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1 border-t-2 border-dashed border-navy-700" />
                  <span className="text-[10px] text-navy-600 select-none whitespace-nowrap">Page break</span>
                  <div className="flex-1 border-t-2 border-dashed border-navy-700" />
                </div>
              </div>
            )}
          </div>

          {scale !== 1 && <div style={{ height: Math.max(0, pageDim.height * (scale - 1)) }} />}

          {showFindReplace && <FindReplace editor={editor} onClose={() => setShowFindReplace(false)} />}
          <LinkBubble editor={editor} />
          <EditorContextMenu editor={editor} containerRef={canvasRef} onAddComment={addComment} />
        </div>

        <div
          className={`transition-all duration-200 ease-out overflow-hidden flex-shrink-0 ${
            showComments ? 'w-72 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <CommentPanel editor={editor} documentId={docId} onClose={() => setShowComments(false)} />
        </div>

        {showGallery && (
          <TemplateGallery
            templates={templates}
            loading={templatesLoading}
            canManage={canManageTemplates}
            replacing={!isDocEmpty(editor.getHTML())}
            onPick={applyTemplate}
            onSaveCurrentAsTemplate={saveCurrentAsTemplate}
            onRename={renameTemplate}
            onDelete={deleteTemplate}
            onSetTag={setTemplateTag}
            onClose={() => setShowGallery(false)}
          />
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-navy-900 border-t border-navy-800 text-[11px] text-navy-400 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
          <span>{charCount} {charCount === 1 ? 'character' : 'characters'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{pageSetup.pageSize === 'a4' ? 'A4' : pageSetup.pageSize === 'legal' ? 'Legal' : 'Letter'}</span>
          <span>·</span>
          <span>{zoom}%</span>
        </div>
      </div>

      {/* ── Dialogs ── */}
      {dialog === 'image' && <ImageInsertDialog editor={editor} docId={docId} onClose={() => setDialog(null)} />}
      {dialog === 'table' && <TableInsertDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'link' && <LinkInsertDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'emoji' && <EmojiPicker editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'pageSetup' && <PageSetupPanel onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsModal onClose={() => setDialog(null)} />}

      {showPalette && (
        <CommandPalette
          editor={editor}
          onClose={() => setShowPalette(false)}
          onOpenSettings={() => setDialog('settings')}
          onToggleFindReplace={() => setShowFindReplace((v) => !v)}
          onToggleComments={() => setShowComments((v) => !v)}
        />
      )}
    </div>
  )
}
