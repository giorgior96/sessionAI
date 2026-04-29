import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  AlertCircle,
  Brain,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderInput,
  LogIn,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  mockGenerateResponse,
  mockShareArtifact,
  mockTrainerAthletes,
} from './mockData'

import type {
  DriveSource,
  FeedbackFormState,
  GenerateJobResponse,
  GenerateJobStatus,
  GenerateResponse,
  ShareArtifact,
  StatusResponse,
  TrainerAthlete,
  UploadedDraft,
  ShareExercise,
  AthleteContextSummary,
} from './types'

const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const DEFAULT_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/u/2/folders/1P3ino0yF5bivKpc1ihjf5FXDuK_ZpkgU'

type GoogleTokenResponse = {
  access_token?: string
  error?: string
}

type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
}

type SheetCell = {
  value: string
  note?: string
}

type SheetComment = {
  id: string
  content: string
  author?: string
  modifiedTime?: string
  quotedValue?: string
}

type SheetPreview = {
  sourceId: string
  sourceName: string
  mode: 'sheets-api' | 'xlsx-export'
  sheets: Array<{
    name: string
    rows: SheetCell[][]
  }>
  comments: SheetComment[]
  warning?: string
}

function buildShareUrl(shareId: string) {
  return `${window.location.origin}${window.location.pathname}#/share/${shareId}`
}

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

function slugifyLocal(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }

  const text = await response.text()
  throw new Error(text.trim() || fallbackMessage)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function parseDriveFolderId(value = '') {
  const trimmed = value.trim()
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (folderMatch) return folderMatch[1]

  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idMatch) return idMatch[1]

  if (/^[a-zA-Z0-9_-]{12,}$/.test(trimmed)) return trimmed
  return ''
}

function formatBytes(value?: string) {
  const bytes = Number(value || 0)
  if (!bytes) return 'Google Sheet'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isUsableDriveFile(file: DriveFile) {
  const mime = file.mimeType || ''
  return (
    mime.includes('spreadsheet') ||
    mime.includes('pdf') ||
    mime.includes('document') ||
    mime.includes('officedocument') ||
    mime.includes('excel')
  )
}

function toDriveSource(file: DriveFile, athleteName: string): DriveSource {
  const isSheet = file.mimeType.includes('spreadsheet')
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    sizeLabel: formatBytes(file.size),
    athleteName,
    extension: isSheet ? '.xlsx' : undefined,
  }
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    )

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google login non caricato.')), {
        once: true,
      })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google login non caricato.'))
    document.head.appendChild(script)
  })
}

async function driveJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Drive API ${response.status}: ${text}`)
  }
  return response.json() as Promise<T>
}

async function sheetsJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Sheets API ${response.status}: ${text}`)
  }
  return response.json() as Promise<T>
}

async function getDriveFolderName(folderId: string, accessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,name',
    supportsAllDrives: 'true',
  })
  const folder = await driveJson<{ name: string }>(
    `https://www.googleapis.com/drive/v3/files/${folderId}?${params}`,
    accessToken,
  )
  return folder.name
}

async function listDriveChildren(folderId: string, accessToken: string) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size)',
    pageSize: '1000',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const payload = await driveJson<{ files: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    accessToken,
  )
  return payload.files ?? []
}

async function importAthletesFromDrive(folderUrl: string, accessToken: string) {
  const folderId = parseDriveFolderId(folderUrl)
  if (!folderId) throw new Error('Incolla un link cartella Google Drive valido.')

  const folderName = await getDriveFolderName(folderId, accessToken)
  const children = await listDriveChildren(folderId, accessToken)
  const childFolders = children.filter((file) =>
    file.mimeType.includes('application/vnd.google-apps.folder'),
  )

  if (childFolders.length > 0) {
    const athletes = await Promise.all(
      childFolders.map(async (folder) => {
        const files = (await listDriveChildren(folder.id, accessToken)).filter(isUsableDriveFile)
        return {
          id: folder.id,
          name: folder.name,
          goal: 'Da definire',
          lastUpdated: files[0]?.modifiedTime ?? new Date().toISOString(),
          sources: files.map((file) => toDriveSource(file, folder.name)),
          notes: [],
        }
      }),
    )

    return athletes.filter((athlete) => athlete.sources.length > 0)
  }

  const files = children.filter(isUsableDriveFile)
  return [
    {
      id: folderId,
      name: folderName,
      goal: 'Da definire',
      lastUpdated: files[0]?.modifiedTime ?? new Date().toISOString(),
      sources: files.map((file) => toDriveSource(file, folderName)),
      notes: [],
    },
  ]
}

async function downloadDriveSource(source: DriveSource, accessToken: string) {
  const isSheet = source.mimeType.includes('spreadsheet')
  const isGoogleDoc = source.mimeType.includes('application/vnd.google-apps.document')
  const exportMime = isSheet
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const url =
    isSheet || isGoogleDoc
      ? `https://www.googleapis.com/drive/v3/files/${source.id}/export?mimeType=${encodeURIComponent(
          exportMime,
        )}`
      : `https://www.googleapis.com/drive/v3/files/${source.id}?alt=media`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Non riesco a scaricare ${source.name} da Drive.`)
  }

  const blob = await response.blob()
  const fileName =
    isSheet && !source.name.endsWith('.xlsx')
      ? `${source.name}.xlsx`
      : isGoogleDoc && !source.name.endsWith('.docx')
        ? `${source.name}.docx`
        : source.name
  return new File([blob], fileName, { type: blob.type || source.mimeType })
}

async function listDriveComments(fileId: string, accessToken: string) {
  const params = new URLSearchParams({
    fields:
      'comments(id,content,modifiedTime,author(displayName),quotedFileContent(value))',
    includeDeleted: 'false',
    pageSize: '100',
  })
  try {
    const payload = await driveJson<{
      comments?: Array<{
        id: string
        content?: string
        modifiedTime?: string
        author?: { displayName?: string }
        quotedFileContent?: { value?: string }
      }>
    }>(`https://www.googleapis.com/drive/v3/files/${fileId}/comments?${params}`, accessToken)

    return (payload.comments ?? []).map((comment) => ({
      id: comment.id,
      content: comment.content ?? '',
      author: comment.author?.displayName,
      modifiedTime: comment.modifiedTime,
      quotedValue: comment.quotedFileContent?.value,
    }))
  } catch {
    return []
  }
}

async function buildSheetPreview(source: DriveSource, accessToken: string): Promise<SheetPreview> {
  if (source.mimeType.includes('application/vnd.google-apps.spreadsheet')) {
    try {
      const params = new URLSearchParams({
        includeGridData: 'true',
        fields:
          'sheets(properties(title),data(rowData(values(formattedValue,note))))',
      })
      const [spreadsheet, comments] = await Promise.all([
        sheetsJson<{
          sheets?: Array<{
            properties?: { title?: string }
            data?: Array<{
              rowData?: Array<{
                values?: Array<{
                  formattedValue?: string
                  note?: string
                }>
              }>
            }>
          }>
        }>(`https://sheets.googleapis.com/v4/spreadsheets/${source.id}?${params}`, accessToken),
        listDriveComments(source.id, accessToken),
      ])

      const sheets = (spreadsheet.sheets ?? []).map((sheet) => {
        const rows =
          sheet.data?.[0]?.rowData
            ?.slice(0, 120)
            .map((row) =>
              (row.values ?? []).map((cell) => ({
                value: cell.formattedValue ?? '',
                note: cell.note,
              })),
            )
            .filter((row) => row.some((cell) => cell.value || cell.note)) ?? []

        return {
          name: sheet.properties?.title ?? 'Foglio',
          rows,
        }
      })

      return {
        sourceId: source.id,
        sourceName: source.name,
        mode: 'sheets-api',
        sheets,
        comments,
      }
    } catch (error) {
      const fallback = await buildXlsxPreview(source, accessToken)
      return {
        ...fallback,
        warning:
          error instanceof Error
            ? `Letta via export XLSX perche Sheets API non e ancora disponibile: ${error.message}`
            : 'Letta via export XLSX perche Sheets API non e ancora disponibile.',
      }
    }
  }

  return buildXlsxPreview(source, accessToken)
}

async function buildXlsxPreview(source: DriveSource, accessToken: string): Promise<SheetPreview> {
  const file = await downloadDriveSource(source, accessToken)
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils
      .sheet_to_json<string[]>(worksheet, {
        header: 1,
        blankrows: false,
        defval: '',
      })
      .slice(0, 80)
      .map((row) => row.map((cell) => ({ value: String(cell ?? '') })))

    return {
      name: sheetName,
      rows,
    }
  })

  return {
    sourceId: source.id,
    sourceName: source.name,
    mode: 'xlsx-export',
    sheets,
    comments: [],
  }
}

function normalizeSheetRows(rows: SheetCell[][]) {
  const nonEmptyRows = rows.filter((row) =>
    row.some((cell) => cell.value.trim() || cell.note?.trim()),
  )

  const maxColumns = Math.max(0, ...nonEmptyRows.map((row) => row.length))
  const activeColumns = Array.from({ length: maxColumns }, (_, columnIndex) =>
    nonEmptyRows.some((row) => {
      const cell = row[columnIndex]
      return cell?.value.trim() || cell?.note?.trim()
    }),
  )

  const compactRows = nonEmptyRows.map((row) =>
    activeColumns
      .map((isActive, columnIndex) => (isActive ? row[columnIndex] ?? { value: '' } : null))
      .filter((cell): cell is SheetCell => Boolean(cell)),
  )

  const headerIndex = Math.max(
    0,
    compactRows.findIndex((row) => {
      const filledCells = row.filter((cell) => cell.value.trim()).length
      const textScore = row.filter((cell) => /[a-zA-Zà-ùÀ-Ù]/.test(cell.value)).length
      return filledCells >= 2 && textScore >= Math.min(2, filledCells)
    }),
  )

  const headers =
    compactRows[headerIndex]?.map((cell, index) => cell.value.trim() || `Colonna ${index + 1}`) ??
    []

  const bodyRows = compactRows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.value.trim() || cell.note?.trim()))

  return { headers, bodyRows }
}

function serializeSheetPreview(preview: SheetPreview) {
  const lines = [
    `# Scheda atleta importata: ${preview.sourceName}`,
    '',
    `Modalita lettura: ${preview.mode}`,
    '',
  ]

  for (const sheet of preview.sheets) {
    const normalized = normalizeSheetRows(sheet.rows)
    lines.push(`## Foglio: ${sheet.name}`, '')

    if (normalized.headers.length > 0) {
      lines.push(`| ${normalized.headers.join(' | ')} |`)
      lines.push(`| ${normalized.headers.map(() => '---').join(' |')} |`)
    }

    for (const row of normalized.bodyRows) {
      const values = normalized.headers.map((_, index) => {
        const cell = row[index]
        const note = cell?.note ? ` [NOTA: ${cell.note}]` : ''
        return `${(cell?.value ?? '').replace(/\|/g, '/').trim()}${note}`
      })
      lines.push(`| ${values.join(' | ')} |`)
    }

    const notes = sheet.rows.flatMap((row, rowIndex) =>
      row
        .map((cell, columnIndex) => ({
          rowIndex,
          columnIndex,
          note: cell.note,
          value: cell.value,
        }))
        .filter((cell) => cell.note?.trim()),
    )

    if (notes.length > 0) {
      lines.push('', '### Note celle')
      for (const note of notes) {
        lines.push(
          `- R${note.rowIndex + 1} C${note.columnIndex + 1}: ${note.value || 'cella vuota'} -> ${note.note}`,
        )
      }
    }

    lines.push('')
  }

  if ((preview.comments ?? []).length > 0) {
    lines.push('## Commenti Drive / Sheet')
    for (const comment of preview.comments) {
      const author = comment.author ? `${comment.author}: ` : ''
      const quoted = comment.quotedValue ? ` [su: ${comment.quotedValue}]` : ''
      lines.push(`- ${author}${comment.content}${quoted}`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function markdownFileName(value: string) {
  return `${value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scheda'}-commenti-progressioni.md`
}

function collectSheetNotes(preview: SheetPreview, sheetIndex: number) {
  const sheet = preview.sheets[sheetIndex]
  if (!sheet) return []

  return sheet.rows.flatMap((row, rowIndex) =>
    row
      .map((cell, columnIndex) => ({
        id: `${sheet.name}-${rowIndex}-${columnIndex}`,
        rowIndex,
        columnIndex,
        value: cell.value,
        note: cell.note,
      }))
      .filter((cell) => cell.note?.trim()),
  )
}

function createEmptyExercise(index: number): ShareExercise {
  return {
    id: `exercise-${Date.now()}-${index}`,
    block: 'Main',
    name: '',
    prescription: '',
    restSeconds: 90,
    notes: '',
    filmPrompt: '',
    cameraSuggested: false,
  }
}

function ProgramReviewEditor({
  draft,
  approved,
  saving,
  onChange,
  onApprove,
}: {
  draft: ShareArtifact
  approved: boolean
  saving: boolean
  onChange: (draft: ShareArtifact) => void
  onApprove: () => void
}) {
  function updateDraft(patch: Partial<ShareArtifact>) {
    onChange({ ...draft, ...patch })
  }

  function updateSession(sessionIndex: number, patch: Partial<ShareArtifact['sessions'][number]>) {
    onChange({
      ...draft,
      sessions: draft.sessions.map((session, index) =>
        index === sessionIndex ? { ...session, ...patch } : session,
      ),
    })
  }

  function updateExercise(
    sessionIndex: number,
    exerciseIndex: number,
    patch: Partial<ShareExercise>,
  ) {
    onChange({
      ...draft,
      sessions: draft.sessions.map((session, currentSessionIndex) =>
        currentSessionIndex === sessionIndex
          ? {
              ...session,
              exercises: session.exercises.map((exercise, currentExerciseIndex) =>
                currentExerciseIndex === exerciseIndex ? { ...exercise, ...patch } : exercise,
              ),
            }
          : session,
      ),
    })
  }

  function addExercise(sessionIndex: number) {
    onChange({
      ...draft,
      sessions: draft.sessions.map((session, index) =>
        index === sessionIndex
          ? {
              ...session,
              exercises: [
                ...session.exercises,
                createEmptyExercise(session.exercises.length + 1),
              ],
            }
          : session,
      ),
    })
  }

  function removeExercise(sessionIndex: number, exerciseIndex: number) {
    onChange({
      ...draft,
      sessions: draft.sessions.map((session, index) =>
        index === sessionIndex
          ? {
              ...session,
              exercises: session.exercises.filter((_, currentIndex) => currentIndex !== exerciseIndex),
            }
          : session,
      ),
    })
  }

  return (
    <section className="coach-review-panel">
      <div className="review-hero">
        <div>
          <p className="panel-kicker">
            <span className="mini-step">4</span>
            Revisione coach
          </p>
          <h2>{draft.programTitle}</h2>
          <p>{draft.overview}</p>
        </div>
        <div className={`approval-badge ${approved ? 'is-approved' : ''}`}>
          {approved ? 'Pubblicata' : 'Bozza privata'}
        </div>
      </div>

      <div className="review-meta-grid">
        <label>
          <span>Titolo scheda</span>
          <input
            value={draft.programTitle}
            onChange={(event) => updateDraft({ programTitle: event.target.value })}
          />
        </label>
        <label>
          <span>Etichetta settimana</span>
          <input
            value={draft.weekLabel}
            onChange={(event) => updateDraft({ weekLabel: event.target.value })}
          />
        </label>
        <label className="full-span">
          <span>Overview atleta</span>
          <textarea
            value={draft.overview}
            onChange={(event) => updateDraft({ overview: event.target.value })}
          />
        </label>
      </div>

      <div className="review-sessions">
        {draft.sessions.map((session, sessionIndex) => (
          <article className="review-session" key={session.id || sessionIndex}>
            <div className="review-session-head">
              <div className="session-title-fields">
                <input
                  value={session.title}
                  onChange={(event) => updateSession(sessionIndex, { title: event.target.value })}
                  aria-label="Titolo sessione"
                />
                <input
                  value={session.focus}
                  onChange={(event) => updateSession(sessionIndex, { focus: event.target.value })}
                  aria-label="Focus sessione"
                />
              </div>
              <button className="ghost-button compact-action" onClick={() => addExercise(sessionIndex)}>
                <Plus size={16} />
                Esercizio
              </button>
            </div>
            <textarea
              className="session-notes-input"
              value={session.notes}
              onChange={(event) => updateSession(sessionIndex, { notes: event.target.value })}
              aria-label="Note sessione"
            />

            <div className="exercise-editor-list">
              {session.exercises.map((exercise, exerciseIndex) => (
                <div className="exercise-editor-row" key={exercise.id || exerciseIndex}>
                  <select
                    value={exercise.block}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, { block: event.target.value })
                    }
                    aria-label="Blocco esercizio"
                  >
                    <option>Warm-up</option>
                    <option>Main</option>
                    <option>Accessory</option>
                    <option>Core</option>
                    <option>Conditioning</option>
                    <option>Other</option>
                  </select>
                  <input
                    value={exercise.name}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, { name: event.target.value })
                    }
                    placeholder="Esercizio"
                    aria-label="Nome esercizio"
                  />
                  <input
                    value={exercise.prescription}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, {
                        prescription: event.target.value,
                      })
                    }
                    placeholder="Serie, reps, tempo"
                    aria-label="Prescrizione esercizio"
                  />
                  <input
                    type="number"
                    min={0}
                    step={15}
                    value={exercise.restSeconds}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, {
                        restSeconds: Number(event.target.value),
                      })
                    }
                    aria-label="Recupero in secondi"
                  />
                  <textarea
                    value={exercise.notes}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, { notes: event.target.value })
                    }
                    placeholder="Note tecniche"
                    aria-label="Note esercizio"
                  />
                  <label className="film-toggle">
                    <input
                      type="checkbox"
                      checked={exercise.cameraSuggested}
                      onChange={(event) =>
                        updateExercise(sessionIndex, exerciseIndex, {
                          cameraSuggested: event.target.checked,
                        })
                      }
                    />
                    Video
                  </label>
                  <input
                    value={exercise.filmPrompt}
                    onChange={(event) =>
                      updateExercise(sessionIndex, exerciseIndex, {
                        filmPrompt: event.target.value,
                      })
                    }
                    placeholder="Prompt video"
                    aria-label="Prompt video"
                  />
                  <button
                    className="icon-danger"
                    onClick={() => removeExercise(sessionIndex, exerciseIndex)}
                    aria-label="Rimuovi esercizio"
                    disabled={session.exercises.length <= 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="review-publish-bar">
        <div>
          <strong>Controlla, integra, poi pubblica.</strong>
          <span>Il link atleta usa solo la versione salvata con la convalida coach.</span>
        </div>
        <button className="primary-button" onClick={onApprove} disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
          Convalida e pubblica
        </button>
      </div>
    </section>
  )
}

function buildInitialFeedback(athlete: TrainerAthlete): FeedbackFormState {
  return {
    athleteName: athlete.name,
    coachName: 'Coach',
    primaryGoal: athlete.goal === 'Da definire' ? '' : athlete.goal,
    trainingDays: 3,
    energy: 'steady',
    recovery: 'steady',
    adherence: 'high',
    pain: 'none',
    topLimitation: '',
    feedbackNotes: '',
    filmingReminder: true,
  }
}

function RestTimer({
  initialSeconds,
  onComplete,
}: {
  initialSeconds: number
  onComplete: () => void
}) {
  const [remaining, setRemaining] = useState(initialSeconds)
  const [running, setRunning] = useState(true)

  useEffect(() => {
    if (!running) return

    const intervalId = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId)
          setRunning(false)
          onComplete()
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [running, onComplete])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60

  return (
    <div className="timer-card">
      <p className="panel-kicker">Recupero In Corso</p>
      <div className="timer-number">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </div>
      <div className="timer-actions">
        <button
          className="ghost-button"
          onClick={() => setRunning((current) => !current)}
        >
          {running ? <Pause size={18} /> : <Play size={18} />}
          {running ? 'Pausa Timer' : 'Riprendi'}
        </button>
        <button
          className="primary-button"
          onClick={() => {
            setRunning(false)
            onComplete()
          }}
        >
          Salta e procedi
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

function TrainerPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const tokenClientRef = useRef<any>(null)
  const [accessToken, setAccessToken] = useState('')
  const [athletes, setAthletes] = useState<TrainerAthlete[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [driveUrl, setDriveUrl] = useState(DEFAULT_DRIVE_FOLDER_URL)
  const [importing, setImporting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [localSources, setLocalSources] = useState<UploadedDraft[]>([])
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [sheetPreview, setSheetPreview] = useState<SheetPreview | null>(null)
  const [activePreviewSheet, setActivePreviewSheet] = useState(0)
  const [previewLoadingId, setPreviewLoadingId] = useState('')
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStage, setGenerationStage] = useState('')
  const [contextMap, setContextMap] = useState<Record<string, AthleteContextSummary>>({})
  const [preparingContext, setPreparingContext] = useState(false)
  const [contextProgress, setContextProgress] = useState(0)
  const [contextStage, setContextStage] = useState('')

  const selectedAthlete = useMemo(
    () => athletes.find((athlete) => athlete.id === selectedId) ?? athletes[0],
    [athletes, selectedId],
  )
  const activeSheetTable = useMemo(() => {
    const rows = sheetPreview?.sheets[activePreviewSheet]?.rows ?? []
    return normalizeSheetRows(rows)
  }, [activePreviewSheet, sheetPreview])
  const activeSheetNotes = useMemo(
    () => (sheetPreview ? collectSheetNotes(sheetPreview, activePreviewSheet) : []),
    [activePreviewSheet, sheetPreview],
  )
  const [feedback, setFeedback] = useState(() =>
    buildInitialFeedback(mockTrainerAthletes[0]),
  )

  useEffect(() => {
    fetch(apiUrl('/api/status'))
      .then((response) =>
        readJsonResponse<StatusResponse>(response, 'Status backend non disponibile.'),
      )
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return

    loadGoogleIdentityScript()
      .then(() => {
        tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: (tokenResponse: GoogleTokenResponse) => {
            if (tokenResponse.error || !tokenResponse.access_token) {
              setError('Login Google non completato.')
              return
            }
            setAccessToken(tokenResponse.access_token)
            setMessage('Login Google Drive completato.')
          },
        })
      })
      .catch((googleError) => {
        setError(
          googleError instanceof Error
            ? googleError.message
            : 'Login Google non disponibile.',
        )
      })
  }, [])

  useEffect(() => {
    if (!selectedAthlete) return
    setFeedback(buildInitialFeedback(selectedAthlete))
    setResult(null)
    setLocalSources([])
    setSheetPreview(null)
    setActivePreviewSheet(0)
  }, [selectedAthlete])

  useEffect(() => {
    if (!selectedAthlete) return
    const athleteSlug = slugifyLocal(selectedAthlete.name)
    fetch(apiUrl(`/api/athlete-context/${athleteSlug}`))
      .then((response) => {
        if (!response.ok) throw new Error('Contesto non preparato')
        return readJsonResponse<AthleteContextSummary>(response, 'Contesto non preparato')
      })
      .then((context) => {
        setContextMap((current) => ({ ...current, [selectedAthlete.id]: context }))
      })
      .catch(() => {
        setContextMap((current) => {
          const next = { ...current }
          delete next[selectedAthlete.id]
          return next
        })
      })
  }, [selectedAthlete])

  function handleSelectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setLocalSources((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
      })),
    ])
    event.target.value = ''
  }

  async function importDriveFolder() {
    setError('')
    setMessage('')

    if (!accessToken) {
      setError('Prima fai login con Google Drive.')
      return
    }

    setImporting(true)

    try {
      const importedAthletes = await importAthletesFromDrive(driveUrl, accessToken)
      if (importedAthletes.length === 0) {
        throw new Error('La cartella non contiene schede leggibili.')
      }

      const fileCount = importedAthletes.reduce(
        (total, athlete) => total + athlete.sources.length,
        0,
      )
      setAthletes(importedAthletes)
      setSelectedId(importedAthletes[0].id)
      setMessage(`Import completato: ${fileCount} schede lette da Drive.`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Errore import Drive.')
    } finally {
      setImporting(false)
    }
  }

  async function openSheetPreview(source: DriveSource) {
    setError('')
    setMessage('')

    if (!accessToken) {
      setError('Prima fai login Google per leggere questa scheda.')
      return
    }

    if (
      !source.mimeType.includes('spreadsheet') &&
      !source.name.toLowerCase().endsWith('.xlsx') &&
      !source.name.toLowerCase().endsWith('.xls')
    ) {
      setError('Anteprima tabellare disponibile per Google Sheet o file Excel.')
      return
    }

    setPreviewLoadingId(source.id)
    setActivePreviewSheet(0)

    try {
      const preview = await buildSheetPreview(source, accessToken)
      setSheetPreview(preview)
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Non riesco a leggere questa scheda.',
      )
    } finally {
      setPreviewLoadingId('')
    }
  }

  async function prepareAthleteContext() {
    if (!selectedAthlete) return

    setError('')
    setMessage('')
    setPreparingContext(true)
    setContextProgress(0)
    setContextStage('Preparazione fonti atleta')

    try {
      if (selectedAthlete.sources.length > 0 && !accessToken) {
        throw new Error('Serve il login Google per preparare il contesto atleta.')
      }

      const formData = new FormData()
      formData.append('athleteName', selectedAthlete.name)
      const driveSourceCount = Math.max(selectedAthlete.sources.length, 1)

      for (const [index, source] of selectedAthlete.sources.entries()) {
        const baseProgress = 8 + Math.round((index / driveSourceCount) * 42)
        setContextProgress(baseProgress)
        setContextStage(`Leggo scheda ${index + 1} di ${selectedAthlete.sources.length}`)
        const file = await downloadDriveSource(source, accessToken)
        formData.append('sources', file)

        if (source.mimeType.includes('spreadsheet')) {
          const preview = await buildSheetPreview(source, accessToken)
          const contextFile = new File(
            [serializeSheetPreview(preview)],
            markdownFileName(source.name),
            { type: 'text/markdown' },
          )
          formData.append('sources', contextFile)
        }
      }

      setContextProgress(56)
      setContextStage('Invio a Codex per sintesi atleta')
      const response = await fetch(apiUrl('/api/athlete-context'), {
        method: 'POST',
        body: formData,
      })
      const payload = await readJsonResponse<GenerateJobResponse & { error?: string }>(
        response,
        'Preparazione contesto non riuscita.',
      )
      if (!response.ok) throw new Error(payload.error || 'Preparazione contesto non riuscita.')

      for (;;) {
        await sleep(3000)
        const jobResponse = await fetch(apiUrl(`/api/jobs/${payload.jobId}`))
        const job = await readJsonResponse<GenerateJobStatus>(
          jobResponse,
          'Stato preparazione non disponibile.',
        )

        if (!jobResponse.ok) {
          throw new Error(job.error || 'Stato preparazione non disponibile.')
        }

        setContextProgress(Math.max(56, Math.min(100, job.progress || 56)))
        setContextStage(job.stage || 'Codex sta preparando il contesto atleta')

        if (job.status === 'succeeded') {
          setContextMap((current) => ({
            ...current,
            [selectedAthlete.id]: job.result as AthleteContextSummary,
          }))
          break
        }

        if (job.status === 'failed') {
          throw new Error(job.error || 'Preparazione contesto non riuscita.')
        }
      }

      setContextProgress(100)
      setContextStage('Contesto atleta pronto')
      setMessage('Contesto atleta pronto: le prossime generazioni saranno piu veloci.')
    } catch (contextError) {
      setError(
        contextError instanceof Error
          ? contextError.message
          : 'Errore durante la preparazione del contesto.',
      )
    } finally {
      setPreparingContext(false)
      window.setTimeout(() => {
        setContextProgress(0)
        setContextStage('')
      }, 2500)
    }
  }

  async function generateProgram() {
    if (!selectedAthlete) return

    setError('')
    setMessage('')
    setGenerating(true)
    setResult(null)
    setGenerationProgress(0)
    setGenerationStage('Preparazione input')

    const formData = new FormData()
    Object.entries(feedback).forEach(([key, value]) => {
      formData.append(key, String(value))
    })
    localSources.forEach((source) => formData.append('sources', source.file))

    try {
      const hasPreparedContext = Boolean(contextMap[selectedAthlete.id])

      if (!hasPreparedContext && selectedAthlete.sources.length > 0 && !accessToken) {
        throw new Error('Serve il login Google per usare le schede Drive.')
      }

      const driveSourceCount = Math.max(selectedAthlete.sources.length, 1)

      for (const [index, source] of (hasPreparedContext ? [] : selectedAthlete.sources).entries()) {
        const baseProgress = 8 + Math.round((index / driveSourceCount) * 42)
        setGenerationProgress(baseProgress)
        setGenerationStage(`Scarico scheda ${index + 1} di ${selectedAthlete.sources.length}`)
        const file = await downloadDriveSource(source, accessToken)
        formData.append('sources', file)

        if (source.mimeType.includes('spreadsheet')) {
          setGenerationProgress(baseProgress + 7)
          setGenerationStage(`Leggo note e commenti: ${source.name}`)
          const preview = await buildSheetPreview(source, accessToken)
          const contextFile = new File(
            [serializeSheetPreview(preview)],
            markdownFileName(source.name),
            { type: 'text/markdown' },
          )
          formData.append('sources', contextFile)
        }
      }

      setGenerationProgress(hasPreparedContext ? 48 : 58)
      setGenerationStage(
        hasPreparedContext
          ? 'Invio feedback: usero il contesto atleta gia pronto'
          : 'Invio fonti al backend',
      )
      const response = await fetch(apiUrl('/api/generate'), {
        method: 'POST',
        body: formData,
      })
      const payload = await readJsonResponse<(GenerateJobResponse | GenerateResponse) & { error?: string }>(
        response,
        'Generazione non riuscita.',
      )
      if (!response.ok) throw new Error(payload.error || 'Generazione non riuscita.')

      if ('shareId' in payload) {
        setResult(payload)
        setGenerationProgress(100)
        setGenerationStage('Apro revisione coach')
        setMessage('Bozza generata. Apro la pagina di revisione.')
        navigate(`/review/${payload.shareId}`)
        return
      }

      if (!('jobId' in payload) || !payload.jobId) {
        throw new Error('Il backend non ha restituito un job di generazione.')
      }

      setGenerationProgress(62)
      setGenerationStage('Generazione avviata sulla VPS')

      for (;;) {
        await sleep(3000)
        const jobResponse = await fetch(apiUrl(`/api/jobs/${payload.jobId}`))
        const job = await readJsonResponse<GenerateJobStatus>(
          jobResponse,
          'Stato generazione non disponibile.',
        )

        if (!jobResponse.ok) {
          throw new Error(job.error || 'Stato generazione non disponibile.')
        }

        setGenerationProgress(Math.max(62, Math.min(100, job.progress || 62)))
        setGenerationStage(job.stage || 'Codex sta lavorando sulla scheda')

        if (job.status === 'succeeded' && job.result && 'shareData' in job.result) {
          setResult(job.result)
          navigate(`/review/${job.result.shareId}`)
          break
        }

        if (job.status === 'failed') {
          throw new Error(job.error || 'Generazione non riuscita.')
        }
      }

      setGenerationProgress(100)
      setGenerationStage('Apro revisione coach')
      setMessage('Bozza generata. Apro la pagina di revisione.')
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : 'Errore durante la generazione.',
      )
    } finally {
      setGenerating(false)
      window.setTimeout(() => {
        setGenerationProgress(0)
        setGenerationStage('')
      }, 2500)
    }
  }

  if (!selectedAthlete) {
    return (
      <main className="trainer-shell">
        <header className="trainer-topbar">
          <div>
            <p className="eyebrow">SESSION.AI TRAINER</p>
            <h1>Centro schede</h1>
          </div>
          <div className="status-strip">
            <span className={status?.codexAvailable ? 'status-dot is-ok' : 'status-dot'} />
            Codex {status?.codexAvailable ? status.codexModel : 'non rilevato'}
          </div>
        </header>

        <section className="drive-import-panel step-panel is-active">
          <div className="step-badge">1</div>
          <div>
            <p className="panel-kicker">Primo step</p>
            <h2>Login e cartella Drive</h2>
          </div>
          <div className="drive-import-controls">
            <button
              className="ghost-button google-button"
              onClick={() => tokenClientRef.current?.requestAccessToken()}
              disabled={!GOOGLE_CLIENT_ID}
            >
              <LogIn size={18} />
              {accessToken ? 'Google connesso' : 'Login Google'}
            </button>
            <input
              value={driveUrl}
              onChange={(event) => setDriveUrl(event.target.value)}
              placeholder="Incolla link cartella Drive"
            />
            <button className="primary-button" onClick={importDriveFolder} disabled={importing}>
              {importing ? <LoaderCircle className="spin" size={18} /> : <FolderInput size={18} />}
              Importa
            </button>
          </div>
          {!GOOGLE_CLIENT_ID && (
            <div className="notice-row">
              <AlertCircle size={18} />
              Configura <code>VITE_GOOGLE_CLIENT_ID</code> per usare il login.
            </div>
          )}
        </section>

        {(error || message) && (
          <div className={`notice-row ${error ? 'is-error' : 'is-success'}`}>
            {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {error || message}
          </div>
        )}

        <section className="empty-state-panel">
          <Users size={28} />
          <h2>Nessun atleta importato</h2>
          <p className="hero-copy">
            Dopo l'import vedrai tutti gli atleti con il numero di schede disponibili.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="trainer-shell">
      <header className="trainer-topbar">
        <div>
          <p className="eyebrow">SESSION.AI TRAINER</p>
          <h1>Centro schede</h1>
        </div>
        <div className="status-strip">
          <span className={status?.codexAvailable ? 'status-dot is-ok' : 'status-dot'} />
          Codex {status?.codexAvailable ? status.codexModel : 'non rilevato'}
        </div>
      </header>

      <section className="drive-import-panel step-panel is-active">
        <div className="step-badge">1</div>
        <div>
          <p className="panel-kicker">Primo step</p>
          <h2>Login e cartella Drive</h2>
        </div>
        <div className="drive-import-controls">
          <button
            className="ghost-button google-button"
            onClick={() => tokenClientRef.current?.requestAccessToken()}
            disabled={!GOOGLE_CLIENT_ID}
          >
            <LogIn size={18} />
            {accessToken ? 'Google connesso' : 'Login Google'}
          </button>
          <input
            value={driveUrl}
            onChange={(event) => setDriveUrl(event.target.value)}
            placeholder="Incolla link cartella Drive"
          />
          <button className="primary-button" onClick={importDriveFolder} disabled={importing}>
            {importing ? <LoaderCircle className="spin" size={18} /> : <FolderInput size={18} />}
            Importa
          </button>
        </div>
        {!GOOGLE_CLIENT_ID && (
          <div className="notice-row">
            <AlertCircle size={18} />
            Configura <code>VITE_GOOGLE_CLIENT_ID</code> per usare il login.
          </div>
        )}
      </section>

      {(error || message) && (
        <div className={`notice-row ${error ? 'is-error' : 'is-success'}`}>
          {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {error || message}
        </div>
      )}

      <section className="trainer-grid">
        <aside className="athlete-rail">
          <div className="rail-heading">
            <span className="mini-step">2</span>
            <Users size={18} />
            <span>{athletes.length} atleti</span>
          </div>
          {athletes.map((athlete) => (
            <button
              key={athlete.id}
              className={`athlete-row ${athlete.id === selectedAthlete.id ? 'is-active' : ''}`}
              onClick={() => setSelectedId(athlete.id)}
            >
              <strong>{athlete.name}</strong>
              <span>
                {athlete.sources.length} schede · {athlete.goal}
              </span>
            </button>
          ))}
        </aside>

        <section className="athlete-workspace">
          <div className="athlete-summary">
            <div>
              <p className="eyebrow">Atleta selezionato</p>
              <h2>{selectedAthlete.name}</h2>
              <p className="hero-copy">{selectedAthlete.goal}</p>
            </div>
            <div className="summary-metrics">
              <div>
                <strong>{selectedAthlete.sources.length}</strong>
                <span>schede</span>
              </div>
              <div>
                <strong>{formatDate(selectedAthlete.lastUpdated)}</strong>
                <span>ultimo update</span>
              </div>
            </div>
          </div>

          <div className="workspace-columns">
            <section className="panel-flat">
              <p className="panel-kicker">
                <Database size={16} />
                Schede importate
              </p>
              <div className="source-list">
                {selectedAthlete.sources.map((source) => (
                  <button
                    className={`history-card ${
                      sheetPreview?.sourceId === source.id ? 'is-selected' : ''
                    }`}
                    key={source.id}
                    onClick={() => openSheetPreview(source)}
                  >
                    <FileSpreadsheet size={18} />
                    <div>
                      <strong>{source.name}</strong>
                      <span>
                        {source.modifiedTime ? formatDate(source.modifiedTime) : 'Fonte Drive'} ·{' '}
                        {source.sizeLabel}
                      </span>
                      {previewLoadingId === source.id && (
                        <span className="preview-loading">
                          <LoaderCircle className="spin" size={14} /> Lettura scheda
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {selectedAthlete.notes.map((note) => (
                <div className="note-pill" key={note}>
                  <FileText size={16} />
                  {note}
                </div>
              ))}
            </section>

            <section className="panel-flat generation-panel">
              <p className="panel-kicker">
                <span className="mini-step">3</span>
                <Brain size={16} />
                Feedback e generazione
              </p>
              <div className="form-grid compact">
                <label>
                  <span>Obiettivo</span>
                  <input
                    value={feedback.primaryGoal}
                    onChange={(event) =>
                      setFeedback({ ...feedback, primaryGoal: event.target.value })
                    }
                    placeholder="Es. HSPU priority + front lever mantenimento"
                  />
                </label>
                <label>
                  <span>Giorni</span>
                  <input
                    type="number"
                    min={1}
                    max={7}
                    value={feedback.trainingDays}
                    onChange={(event) =>
                      setFeedback({ ...feedback, trainingDays: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>Energia</span>
                  <select
                    value={feedback.energy}
                    onChange={(event) =>
                      setFeedback({ ...feedback, energy: event.target.value as FeedbackFormState['energy'] })
                    }
                  >
                    <option value="high">Alta</option>
                    <option value="steady">Stabile</option>
                    <option value="low">Bassa</option>
                  </select>
                </label>
                <label>
                  <span>Dolori</span>
                  <select
                    value={feedback.pain}
                    onChange={(event) =>
                      setFeedback({ ...feedback, pain: event.target.value as FeedbackFormState['pain'] })
                    }
                  >
                    <option value="none">Nessuno</option>
                    <option value="managed">Gestibile</option>
                    <option value="present">Presente</option>
                  </select>
                </label>
                <label className="full-span">
                  <span>Feedback atleta</span>
                  <textarea
                    value={feedback.topLimitation}
                    onChange={(event) =>
                      setFeedback({ ...feedback, topLimitation: event.target.value })
                    }
                    placeholder="Esempio: HSPU piu stabile, ma fastidio spalla destra dopo dip pesanti."
                  />
                </label>
                <label className="full-span">
                  <span>Note trainer</span>
                  <textarea
                    value={feedback.feedbackNotes}
                    onChange={(event) =>
                      setFeedback({ ...feedback, feedbackNotes: event.target.value })
                    }
                    placeholder="Decisioni tecniche, vincoli, obiettivi della prossima fase."
                  />
                </label>
              </div>

              <label className="mini-upload">
                <FileText size={18} />
                Aggiungi file extra
                <input type="file" multiple onChange={handleSelectFiles} />
              </label>
              {localSources.map((source) => (
                <div className="source-card compact-card" key={source.id}>
                  <span>{source.name}</span>
                  <span className="muted">{source.sizeLabel}</span>
                </div>
              ))}

              <div className="context-prep-box">
                <div>
                  <strong>
                    {contextMap[selectedAthlete.id]
                      ? 'Contesto Codex pronto'
                      : 'Prepara contesto veloce'}
                  </strong>
                  <span>
                    {contextMap[selectedAthlete.id]
                      ? 'Genera usera profilo sintetico e feedback, senza rileggere tutte le schede.'
                      : 'Codex sintetizza una volta storico e progressioni. Poi generare sara piu rapido.'}
                  </span>
                </div>
                <button
                  className="ghost-button compact-action"
                  onClick={prepareAthleteContext}
                  disabled={preparingContext || generating}
                >
                  {preparingContext ? <LoaderCircle className="spin" size={16} /> : <Database size={16} />}
                  {contextMap[selectedAthlete.id] ? 'Aggiorna' : 'Prepara'}
                </button>
              </div>

              {(preparingContext || contextProgress > 0) && (
                <div className="generation-progress">
                  <div className="generation-progress-top">
                    <span>{contextStage || 'Preparazione contesto'}</span>
                    <strong>{contextProgress}%</strong>
                  </div>
                  <div className="generation-progress-track">
                    <div style={{ width: `${contextProgress}%` }} />
                  </div>
                </div>
              )}

              <button
                className="primary-button generate-button"
                onClick={generateProgram}
                disabled={generating || preparingContext}
              >
                {generating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                Genera nuova scheda
              </button>
              {(generating || generationProgress > 0) && (
                <div className="generation-progress">
                  <div className="generation-progress-top">
                    <span>{generationStage || 'Generazione in corso'}</span>
                    <strong>{generationProgress}%</strong>
                  </div>
                  <div className="generation-progress-track">
                    <div style={{ width: `${generationProgress}%` }} />
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className="panel-flat sheet-preview-panel">
              <p className="panel-kicker">
                <FileSpreadsheet size={16} />
                Anteprima scheda
              </p>
              {sheetPreview ? (
                <>
                  <div className="sheet-preview-title">
                    <strong>{sheetPreview.sourceName}</strong>
                    <span>{sheetPreview.sheets.length} fogli</span>
                  </div>
                  <div className="sheet-tabs">
                    {sheetPreview.sheets.map((sheet, index) => (
                      <button
                        key={sheet.name}
                        className={index === activePreviewSheet ? 'is-active' : ''}
                        onClick={() => setActivePreviewSheet(index)}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                  {sheetPreview.warning && (
                    <div className="notice-row">
                      <AlertCircle size={18} />
                      {sheetPreview.warning}
                    </div>
                  )}
                  <div className="sheet-insight-grid">
                    <div className="sheet-insight">
                      <strong>{activeSheetNotes.length}</strong>
                      <span>note celle nel foglio</span>
                    </div>
                    <div className="sheet-insight">
                      <strong>{(sheetPreview.comments ?? []).length}</strong>
                      <span>commenti Drive</span>
                    </div>
                  </div>
                  <div className="sheet-table-wrap">
                    <table className="program-table">
                      <thead>
                        <tr>
                          {activeSheetTable.headers.map((header, index) => (
                            <th key={`${header}-${index}`}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeSheetTable.bodyRows.map((row, rowIndex) => (
                          <tr key={`${activePreviewSheet}-${rowIndex}`}>
                            {row.map((cell, cellIndex) => (
                              <td
                                key={`${rowIndex}-${cellIndex}`}
                                className={cell.note ? 'has-note' : ''}
                              >
                                <span>{cell.value}</span>
                                {cell.note && (
                                  <span className="cell-note">
                                    <MessageSquareText size={13} />
                                    {cell.note}
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {activeSheetTable.bodyRows.length === 0 && (
                      <div className="sheet-empty in-table">
                        <strong>Questo foglio non contiene righe tabellari leggibili.</strong>
                      </div>
                    )}
                  </div>
                  <div className="sheet-comments">
                    <p className="panel-kicker">
                      <MessageSquareText size={16} />
                      Note e commenti
                    </p>
                    {activeSheetNotes.length > 0 && (
                      <>
                        {activeSheetNotes.map((note) => (
                          <div className="sheet-comment is-note" key={note.id}>
                            <strong>
                              Nota cella R{note.rowIndex + 1} C{note.columnIndex + 1}
                            </strong>
                            {note.value && <span>{note.value}</span>}
                            <p>{note.note}</p>
                          </div>
                        ))}
                      </>
                    )}
                    {(sheetPreview.comments ?? []).length > 0 ? (
                      <>
                        <p className="panel-kicker compact-kicker">
                          <MessageSquareText size={16} />
                          Commenti Drive
                        </p>
                        {(sheetPreview.comments ?? []).map((comment) => (
                          <div className="sheet-comment" key={comment.id}>
                            <strong>{comment.author || 'Commento'}</strong>
                            {comment.quotedValue && <span>{comment.quotedValue}</span>}
                            <p>{comment.content}</p>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="sheet-comment is-empty">
                        <strong>Nessun commento Drive restituito</strong>
                        <p>
                          Se i commenti sono quelli moderni di Google Sheets, Google potrebbe non
                          esporli come commenti Drive; le note cella invece vengono evidenziate qui
                          e dentro la tabella.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="sheet-empty">
                  <FileSpreadsheet size={24} />
                  <strong>Seleziona una scheda</strong>
                  <span>Qui vedrai il contenuto del Google Sheet prima di generare.</span>
                </div>
              )}
          </section>

          {result && (
            <section className="result-panel">
              <div>
                <p className="panel-kicker">Bozza generata</p>
                <h2>{result.programTitle}</h2>
                <p className="hero-copy">
                  Apri la pagina dedicata per controllare, modificare e pubblicare la scheda.
                </p>
              </div>
              <div className="result-actions">
                <Link className="primary-button" to={`/review/${result.shareId}`}>
                  Apri revisione coach
                  <ExternalLink size={18} />
                </Link>
              </div>
            </section>
          )}
        </section>
      </section>
    </main>
  )
}

function ReviewPage() {
  const { shareId = '' } = useParams()
  const [draftShare, setDraftShare] = useState<ShareArtifact | null>(null)
  const [shareApproved, setShareApproved] = useState(false)
  const [savingShare, setSavingShare] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setError('')
    setMessage('')
    setShareApproved(false)
    fetch(apiUrl(`/api/share/${shareId}`))
      .then((response) => {
        if (!response.ok) throw new Error('Bozza non trovata')
        return readJsonResponse<ShareArtifact>(response, 'Bozza non trovata')
      })
      .then(setDraftShare)
      .catch((reviewError) => {
        setError(
          reviewError instanceof Error
            ? reviewError.message
            : 'Non riesco ad aprire la bozza.',
        )
      })
  }, [shareId])

  async function copyAthleteUrl() {
    if (!draftShare) return
    try {
      await navigator.clipboard.writeText(buildShareUrl(draftShare.shareId))
      setMessage('Link atleta copiato negli appunti.')
      window.setTimeout(() => setMessage(''), 3000)
    } catch {
      setMessage('Non riesco a copiare il link.')
    }
  }

  async function approveShareDraft() {
    if (!draftShare) return

    setError('')
    setMessage('')
    setSavingShare(true)

    try {
      const response = await fetch(apiUrl(`/api/share/${draftShare.shareId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftShare),
      })
      const savedShare = await readJsonResponse<ShareArtifact & { error?: string }>(
        response,
        'Salvataggio scheda non riuscito.',
      )

      if (!response.ok) {
        throw new Error(savedShare.error || 'Salvataggio scheda non riuscito.')
      }

      setDraftShare(savedShare)
      setShareApproved(true)
      setMessage('Scheda convalidata. Ora puoi condividere il link atleta.')
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : 'Non riesco a pubblicare la scheda.',
      )
    } finally {
      setSavingShare(false)
    }
  }

  return (
    <main className="review-page-shell">
      <header className="review-topbar">
        <div>
          <p className="eyebrow">Revisione coach</p>
          <h1>Bozza scheda</h1>
        </div>
        <Link className="ghost-button" to="/">
          Centro schede
        </Link>
      </header>

      {(error || message) && (
        <div className={`notice-row ${error ? 'is-error' : 'is-success'}`}>
          {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {error || message}
        </div>
      )}

      {draftShare ? (
        <>
          <section className="evidence-strip">
            <div>
              <p className="panel-kicker">
                <Brain size={16} />
                Base scientifica
              </p>
              <strong>La bozza usa evidence pack locali letti da Codex.</strong>
              <span>
                Progressione, specificita, gestione fatica, recupero e load management vengono
                applicati insieme allo storico atleta.
              </span>
            </div>
          </section>

          <ProgramReviewEditor
            draft={draftShare}
            approved={shareApproved}
            saving={savingShare}
            onChange={(nextDraft) => {
              setDraftShare(nextDraft)
              setShareApproved(false)
            }}
            onApprove={approveShareDraft}
          />

          <section className={`result-panel ${shareApproved ? 'is-share-ready' : ''}`}>
            <div>
              <p className="panel-kicker">Condivisione atleta</p>
              <h2>{shareApproved ? 'Link pronto' : 'In attesa di convalida'}</h2>
              <p className="hero-copy">
                {shareApproved
                  ? 'La versione approvata e salvata e disponibile per l’allievo.'
                  : 'Pubblica la bozza dopo le modifiche. Il link si usa solo quando la convalida e completata.'}
              </p>
            </div>
            <div className="result-actions">
              <button className="ghost-button" onClick={copyAthleteUrl} disabled={!shareApproved}>
                <Copy size={18} />
                Copia link
              </button>
              <Link
                className={`primary-button ${!shareApproved ? 'is-disabled-link' : ''}`}
                to={shareApproved ? `/share/${draftShare.shareId}` : '#'}
                onClick={(event) => {
                  if (!shareApproved) event.preventDefault()
                }}
              >
                Apri vista atleta
                <ExternalLink size={18} />
              </Link>
            </div>
          </section>
        </>
      ) : (
        <section className="empty-state-panel">
          <LoaderCircle className="spin" size={28} />
          <h2>Carico bozza</h2>
          <p className="hero-copy">Sto aprendo la scheda generata per la revisione.</p>
        </section>
      )}
    </main>
  )
}

function AthletePage() {
  const { shareId = '' } = useParams()
  const [share, setShare] = useState<ShareArtifact | null>(null)
  const [sessionIndex, setSessionIndex] = useState(0)
  const [isOverview, setIsOverview] = useState(true)
  const [exerciseIndex, setExerciseIndex] = useState(0)
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [isResting, setIsResting] = useState(false)
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState<string | null>(null)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(apiUrl(`/api/share/${shareId}`))
      .then((response) => {
        if (!response.ok) throw new Error('Share non trovato')
        return readJsonResponse<ShareArtifact>(response, 'Share non trovato')
      })
      .then(setShare)
      .catch(() => {
        if (shareId === mockGenerateResponse.shareId || !shareId) {
          setShare(mockShareArtifact)
        } else {
          setShare(mockShareArtifact)
        }
      })
  }, [shareId])

  const currentSession = share?.sessions[sessionIndex]
  const currentExercise = currentSession?.exercises[exerciseIndex]

  const seriesTotal = useMemo(() => {
    if (!currentExercise) return 1
    const match = currentExercise.prescription.match(/^\d+/)
    return match ? parseInt(match[0], 10) : 1
  }, [currentExercise])

  if (!share || !currentSession || !currentExercise) {
    return (
      <main className="athlete-shell">
        <LoaderCircle className="spin" size={32} />
      </main>
    )
  }

  const isFirstExercise = exerciseIndex === 0
  const isLastExercise = exerciseIndex === currentSession.exercises.length - 1
  const isLastSeries = seriesIndex >= seriesTotal - 1
  const showCamera = currentExercise.cameraSuggested && (seriesIndex === 0 || isLastSeries)

  function handleCompleteSeries() {
    if (isLastSeries) {
      if (isLastExercise) {
        window.alert('Sessione completata, grandissimo!')
      } else {
        setIsResting(false)
        setExerciseIndex((current) => current + 1)
        setSeriesIndex(0)
        setCameraPreviewUrl(null)
      }
    } else {
      setIsResting(true)
    }
  }

  function handleRestComplete() {
    setIsResting(false)
    setSeriesIndex((current) => current + 1)
  }

  function goToPreviousExercise() {
    if (!isFirstExercise) {
      setExerciseIndex((current) => current - 1)
      setSeriesIndex(0)
      setIsResting(false)
      setCameraPreviewUrl(null)
    }
  }

  function goToNextExercise() {
    if (!isLastExercise) {
      setExerciseIndex((current) => current + 1)
      setSeriesIndex(0)
      setIsResting(false)
      setCameraPreviewUrl(null)
    }
  }

  return (
    <main className="athlete-shell">
      {isOverview && (
        <section className="athlete-hero">
          <div>
            <p className="eyebrow">{share.weekLabel}</p>
            <h1>{share.athleteName}</h1>
            <p className="hero-copy">{share.programTitle}</p>
          </div>
        </section>
      )}

      <section className="session-tabs">
        {share.sessions.map((session, index) => (
          <button
            key={session.id}
            className={`session-tab ${index === sessionIndex ? 'is-active' : ''}`}
            onClick={() => {
              setSessionIndex(index)
              setIsOverview(true)
              setExerciseIndex(0)
              setSeriesIndex(0)
              setIsResting(false)
              setCameraPreviewUrl(null)
            }}
          >
            <strong>{session.title}</strong>
          </button>
        ))}
      </section>

      {isOverview ? (
        <section className="exercise-main-card">
          <h2 className="exercise-title">Overview: {currentSession.title}</h2>
          <p className="muted session-focus">{currentSession.focus}</p>

          <div className="exercise-list">
            {currentSession.exercises.map((exercise, index) => (
              <div className="athlete-exercise-row" key={exercise.id}>
                <div className="exercise-block">{exercise.block}</div>
                <div className="exercise-name">
                  {index + 1}. {exercise.name}
                </div>
                <div className="exercise-small">{exercise.prescription}</div>
              </div>
            ))}
          </div>

          <button className="primary-button start-session" onClick={() => setIsOverview(false)}>
            Inizia sessione <Play size={20} />
          </button>
        </section>
      ) : isResting ? (
        <RestTimer initialSeconds={currentExercise.restSeconds} onComplete={handleRestComplete} />
      ) : (
        <section className="exercise-main-card">
          <div>
            <p className="panel-kicker">
              {currentSession.focus} · Esercizio {exerciseIndex + 1} di{' '}
              {currentSession.exercises.length}
            </p>
            <h2 className="exercise-title">{currentExercise.name}</h2>
            <div className="exercise-prescription">{currentExercise.prescription}</div>
          </div>

          <p className="muted exercise-notes">{currentExercise.notes}</p>

          <div className="series-tracker">
            <div className="series-dots">
              {Array.from({ length: seriesTotal }).map((_, index) => (
                <div
                  key={index}
                  className={`series-dot ${
                    index < seriesIndex ? 'done' : index === seriesIndex ? 'current' : ''
                  }`}
                />
              ))}
            </div>
            <p className="eyebrow">Serie {seriesIndex + 1} di {seriesTotal}</p>
          </div>

          <div className="athlete-action-stack">
            {showCamera && (
              <div className="capture-panel">
                <div className="capture-header">
                  <p className="panel-kicker">Registra video</p>
                  <label className="camera-button">
                    <Camera size={16} /> Apri
                    <input
                      type="file"
                      accept="video/*"
                      capture="environment"
                      className="visually-hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) setCameraPreviewUrl(URL.createObjectURL(file))
                      }}
                    />
                  </label>
                </div>
                {currentExercise.filmPrompt && (
                  <p className="muted camera-copy">{currentExercise.filmPrompt}</p>
                )}
                {cameraPreviewUrl && <div className="camera-preview">Video catturato</div>}
              </div>
            )}

            <details className="feedback-details">
              <summary>Aggiungi note o feedback</summary>
              <textarea
                placeholder="Es. dolore in spinta, carichi effettivi..."
                value={feedbackMap[currentExercise.id] || ''}
                onChange={(event) =>
                  setFeedbackMap((current) => ({
                    ...current,
                    [currentExercise.id]: event.target.value,
                  }))
                }
              />
            </details>
          </div>
        </section>
      )}

      {!isOverview && (
        <nav className="sticky-nav">
          <button className="primary-button" onClick={handleCompleteSeries}>
            {isLastSeries
              ? isLastExercise
                ? 'Fine workout'
                : 'Prossimo esercizio'
              : `Completa serie ${seriesIndex + 1}`}
          </button>
          <div className="nav-secondary-row">
            <button className="ghost-button" onClick={goToPreviousExercise} disabled={isFirstExercise}>
              <ChevronLeft size={16} /> Prec
            </button>
            <button className="ghost-button" onClick={goToNextExercise} disabled={isLastExercise}>
              Succ <ChevronRight size={16} />
            </button>
          </div>
        </nav>
      )}
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<TrainerPage />} />
      <Route path="/review/:shareId" element={<ReviewPage />} />
      <Route path="/share/:shareId" element={<AthletePage />} />
    </Routes>
  )
}

export default App
