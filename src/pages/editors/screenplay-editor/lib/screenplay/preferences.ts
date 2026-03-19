import { supabase } from '../../../../../supabaseClient'

export type WritingMode = 'normal' | 'focus' | 'typewriter'
export type ScreenplayTheme = 'dark' | 'light'

export interface ScreenwriterPreferences {
  writingMode: WritingMode
  theme: ScreenplayTheme
  zoom: number
  showSceneNumbers: boolean
}

const STORAGE_KEY = 'screenwriter-preferences'

const DEFAULTS: ScreenwriterPreferences = {
  writingMode: 'normal',
  theme: 'dark',
  zoom: 100,
  showSceneNumbers: false,
}

export function loadPreferences(): ScreenwriterPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULTS, ...parsed }
    }
  } catch {}
  return { ...DEFAULTS }
}

export function savePreferences(prefs: ScreenwriterPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {}
  debouncedSaveToSupabase(prefs)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSaveToSupabase(prefs: ScreenwriterPreferences): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('screenwriter_preferences').upsert({
        user_id: user.id,
        writing_mode: prefs.writingMode,
        theme: prefs.theme,
        zoom: prefs.zoom,
        show_scene_numbers: prefs.showSceneNumbers,
        updated_at: new Date().toISOString(),
      })
    } catch {}
  }, 2000)
}

export async function syncPreferences(
  local: ScreenwriterPreferences
): Promise<ScreenwriterPreferences> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return local

    const { data } = await supabase
      .from('screenwriter_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (data && data.updated_at) {
      return {
        writingMode: data.writing_mode || local.writingMode,
        theme: data.theme || local.theme,
        zoom: data.zoom ?? local.zoom,
        showSceneNumbers: data.show_scene_numbers ?? local.showSceneNumbers,
      }
    }
  } catch {}
  return local
}
