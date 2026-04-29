import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const repoRoot = appRoot
const distDir = path.join(appRoot, 'dist')
const rawSourcesDir = path.join(repoRoot, 'raw', 'sources')
const dataDir = path.join(appRoot, 'data')
const sharesDir = path.join(dataDir, 'shares')
const runsDir = path.join(dataDir, 'runs')
const driveCacheDir = path.join(dataDir, 'drive-cache')
const athleteContextsDir = path.join(dataDir, 'athlete-contexts')
const upload = multer({ storage: multer.memoryStorage() })
const app = express()
const port = Number(process.env.PORT ?? 8787)
const codexModel = process.env.COACH_MVP_CODEX_MODEL ?? 'gpt-5.4-mini'
const googleApiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_DRIVE_API_KEY

let runInProgress = false
const jobs = new Map()

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'raw_source_paths',
    'source_note_paths',
    'analysis_path',
    'program_path',
    'share_path',
    'share_id',
    'program_title',
    'athlete_name',
    'updated_paths',
  ],
  properties: {
    summary: { type: 'string' },
    athlete_name: { type: 'string' },
    program_title: { type: 'string' },
    raw_source_paths: {
      type: 'array',
      items: { type: 'string' },
    },
    source_note_paths: {
      type: 'array',
      items: { type: 'string' },
    },
    analysis_path: { type: 'string' },
    program_path: { type: 'string' },
    share_path: { type: 'string' },
    share_id: { type: 'string' },
    updated_paths: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}

const contextOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'athlete_name',
    'context_path',
    'profile_path',
    'latest_state_path',
    'source_paths',
    'updated_paths',
  ],
  properties: {
    summary: { type: 'string' },
    athlete_name: { type: 'string' },
    context_path: { type: 'string' },
    profile_path: { type: 'string' },
    latest_state_path: { type: 'string' },
    source_paths: {
      type: 'array',
      items: { type: 'string' },
    },
    updated_paths: {
      type: 'array',
      items: { type: 'string' },
    },
  },
}

app.use(cors())
app.use(express.json({ limit: '1mb' }))

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

function guessAthleteName(fileName) {
  const baseName = path.parse(fileName).name
  const cleaned = baseName
    .replace(/\b(20\d{2}[-_. ]?\d{1,2}[-_. ]?\d{1,2}|scheda|sheet|workout|programma|program|training|allenamento|v\d+)\b/gi, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || 'Atleta senza nome'
}

function normalizeDriveFile(file) {
  const mimeType = file.mimeType || ''
  const isSheet = mimeType.includes('spreadsheet')
  const extension = isSheet ? '.xlsx' : path.extname(file.name) || '.pdf'

  return {
    id: file.id,
    name: file.name,
    mimeType,
    modifiedTime: file.modifiedTime,
    sizeLabel: file.size ? formatSize(Number(file.size)) : 'Google Sheet',
    athleteName: guessAthleteName(file.name),
    extension,
    downloadUrl: isSheet
      ? `https://docs.google.com/spreadsheets/d/${file.id}/export?format=xlsx`
      : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${googleApiKey}`,
  }
}

async function fetchDriveChildren(folderId) {
  if (!googleApiKey) {
    throw new Error('Manca GOOGLE_API_KEY o GOOGLE_DRIVE_API_KEY nel file .env per leggere Google Drive.')
  }

  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&pageSize=1000&key=${googleApiKey}`
  const result = await fetch(url)

  if (!result.ok) {
    const text = await result.text()
    throw new Error(`Google Drive non ha risposto correttamente (${result.status}). ${text}`)
  }

  const payload = await result.json()
  return payload.files ?? []
}

function groupDriveFilesByAthlete(files) {
  const groups = new Map()

  for (const file of files.map(normalizeDriveFile)) {
    const key = slugify(file.athleteName)
    const current = groups.get(key) ?? {
      id: key,
      name: file.athleteName,
      goal: 'Da definire',
      lastUpdated: file.modifiedTime ?? new Date().toISOString(),
      sources: [],
      notes: [],
    }

    current.sources.push(file)
    if (!current.lastUpdated || file.modifiedTime > current.lastUpdated) {
      current.lastUpdated = file.modifiedTime
    }
    groups.set(key, current)
  }

  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
}

async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true })
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureKnowledgeBase() {
  const requiredFiles = new Map([
    [
      path.join(repoRoot, 'AGENTS.md'),
      [
        '# SessionAI Knowledge Workflow',
        '',
        '- Treat files in raw/sources as immutable source material.',
        '- Summarize uploaded athlete sheets in wiki/sources before changing programs.',
        '- Keep decisions traceable in wiki/analyses.',
        '- Store athlete-facing programs in wiki/programs and keep data/shares JSON aligned with the program.',
        '- Prefer evidence-informed calisthenics programming: progressive overload, proximity to failure management, recovery signals, specificity, and injury-risk constraints.',
        '',
      ].join('\n'),
    ],
    [
      path.join(repoRoot, 'wiki/index.md'),
      [
        '# SessionAI Wiki Index',
        '',
        '## Core Pages',
        '- wiki/meta/athlete-profile.md',
        '- wiki/meta/single-athlete-workflow.md',
        '- wiki/log.md',
        '',
        '## Programming Principles',
        '- Use previous athlete sheets as the style and progression baseline.',
        '- Use current athlete feedback to adjust volume, intensity, exercise selection, and monitoring prompts.',
        '- Record scientific rationale in every analysis memo.',
        '',
      ].join('\n'),
    ],
    [
      path.join(repoRoot, 'wiki/log.md'),
      '# SessionAI Log\n\n',
    ],
    [
      path.join(repoRoot, 'wiki/meta/athlete-profile.md'),
      '# Athlete Profile\n\nDurable athlete signals live here.\n',
    ],
    [
      path.join(repoRoot, 'wiki/meta/single-athlete-workflow.md'),
      [
        '# Single Athlete Workflow',
        '',
        '1. Read prior sheets and check-in notes.',
        '2. Extract progression history, bottlenecks, pain signals, and adherence.',
        '3. Create a rationale memo before finalizing the program.',
        '4. Produce a mobile share JSON for the athlete app.',
        '',
      ].join('\n'),
    ],
  ])

  await ensureDir(path.join(repoRoot, 'wiki/sources'))
  await ensureDir(path.join(repoRoot, 'wiki/analyses'))
  await ensureDir(path.join(repoRoot, 'wiki/programs'))
  await ensureDir(path.join(repoRoot, 'wiki/meta'))
  await ensureDir(path.join(repoRoot, 'wiki/athletes'))
  await ensureDir(path.join(repoRoot, 'wiki/science'))
  await ensureDir(rawSourcesDir)

  for (const [filePath, contents] of requiredFiles.entries()) {
    if (!(await pathExists(filePath))) {
      await fs.writeFile(filePath, contents)
    }
  }
}

async function uniquePath(directoryPath, fileName) {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 1

  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }

  return candidate
}

async function listFilesRecursively(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name)

      if (entry.isDirectory()) {
        return listFilesRecursively(fullPath)
      }

      return [fullPath]
    }),
  )

  return files.flat()
}

function athleteTokens(value) {
  const slug = slugify(value)

  return Array.from(
    new Set(
      slug
        .split('-')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  )
}

function selectSciencePaths(feedback = {}) {
  const text = [
    feedback.primaryGoal,
    feedback.topLimitation,
    feedback.feedbackNotes,
    feedback.pain,
  ]
    .join(' ')
    .toLowerCase()

  const paths = new Set([
    'wiki/science/resistance-training-principles.md',
    'wiki/science/recovery-and-fatigue.md',
    'wiki/science/calisthenics-goal-rules.md',
  ])

  if (
    /front|lever|planche|handstand|hspu|muscle|skill|isometric|tenuta|verticale/i.test(text)
  ) {
    paths.add('wiki/science/skill-and-isometric-training.md')
  }

  if (
    feedback.pain === 'managed' ||
    feedback.pain === 'present' ||
    /dolor|pain|spalla|gomito|polso|tendin|fastidio|infiam/i.test(text)
  ) {
    paths.add('wiki/science/load-management-and-tendons.md')
  }

  return Array.from(paths)
}

function formatScienceInstruction(sciencePaths) {
  return `
Principi scientifici da applicare obbligatoriamente:
${sciencePaths.map((sciencePath) => `- ${sciencePath}`).join('\n')}

Usali come evidence pack pratico. Non fare ricerca web. Non inventare studi.
Nel memo/programma collega le scelte principali a questi principi: progressione, specificita, gestione fatica, recupero, tolleranza dei tessuti, qualita tecnica.
`.trim()
}

async function collectRelevantWikiPaths(athleteName) {
  await ensureKnowledgeBase()
  const wikiDir = path.join(repoRoot, 'wiki')
  const candidateFiles = await listFilesRecursively(wikiDir)
  const markdownFiles = candidateFiles.filter((filePath) => filePath.endsWith('.md'))
  const basePaths = [
    'wiki/meta/single-athlete-workflow.md',
  ]
  const tokens = athleteTokens(athleteName)
  const scored = []

  for (const fullPath of markdownFiles) {
    const relativePath = path.relative(repoRoot, fullPath)

    if (basePaths.includes(relativePath)) {
      continue
    }

    const fileText = await fs.readFile(fullPath, 'utf8')
    const haystack = `${relativePath}\n${fileText}`.toLowerCase()
    let score = 0
    let hasAthleteToken = false

    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 3
        hasAthleteToken = true
      }
    }

    if (!hasAthleteToken) {
      continue
    }

    if (relativePath.includes('wiki/programs/')) {
      score += 1
    }

    if (relativePath.includes('wiki/analyses/')) {
      score += 1
    }

    if (relativePath.includes('wiki/sources/')) {
      score += 1
    }

    if (score > 0) {
      scored.push({ relativePath, score })
    }
  }

  scored.sort((left, right) => right.score - left.score)

  return [...basePaths, ...scored.slice(0, 8).map((entry) => entry.relativePath)]
}

function buildCheckinSource({ feedback, uploadedSources, checkinRelativePath }) {
  const lines = [
    `# Coach App Check-In | ${feedback.athleteName}`,
    '',
    `Data: ${todayStamp()}`,
    '',
    '## Coach Context',
    `- Coach: ${feedback.coachName || 'non specificato'}`,
    `- Obiettivo primario: ${feedback.primaryGoal}`,
    `- Giorni settimanali richiesti: ${feedback.trainingDays}`,
    '',
    '## Recovery Signals',
    `- Energia: ${feedback.energy}`,
    `- Recupero: ${feedback.recovery}`,
    `- Aderenza: ${feedback.adherence}`,
    `- Dolore o fastidi: ${feedback.pain}`,
    '',
    '## Main Limitation',
    feedback.topLimitation || 'Non specificata',
    '',
    '## Coach Notes',
    feedback.feedbackNotes || 'Nessuna nota aggiuntiva.',
    '',
    '## Uploaded Sources',
    ...uploadedSources.map((sourcePath) => `- ${sourcePath}`),
    '',
    '## Delivery Intent',
    '- Generare la prossima scheda dopo aver integrato i segnali delle fonti e del check-in.',
    '- Produrre anche un artefatto share mobile-friendly per l’atleta.',
    '',
    '## Metadata',
    `- Percorso fonte grezza: ${checkinRelativePath}`,
  ]

  return `${lines.join('\n')}\n`
}

function buildPrompt({
  feedback,
  uploadedSourcePaths,
  checkinSourcePath,
  relevantWikiPaths,
  sciencePaths,
  shareRelativePath,
  shareId,
}) {
  const coachContext = JSON.stringify(
    {
      athleteName: feedback.athleteName,
      coachName: feedback.coachName,
      primaryGoal: feedback.primaryGoal,
      trainingDays: Number(feedback.trainingDays),
      energy: feedback.energy,
      recovery: feedback.recovery,
      adherence: feedback.adherence,
      pain: feedback.pain,
      topLimitation: feedback.topLimitation,
      feedbackNotes: feedback.feedbackNotes,
      filmingReminder: feedback.filmingReminder === 'true',
    },
    null,
    2,
  )

  return `
Stai lavorando nel repository ${repoRoot}.

Segui rigorosamente le istruzioni in AGENTS.md. Questo repository e' un LLM wiki e il workflow da replicare e' quello reale di knowledge, non una simulazione.

Prima di fare qualsiasi scelta:
1. leggi wiki/index.md
2. leggi SOLO queste pagine del wiki come contesto iniziale, salvo che si rivelino chiaramente insufficienti:
${relevantWikiPaths.map((pagePath) => `   - ${pagePath}`).join('\n')}
3. leggi questi file scientifici:
${sciencePaths.map((pagePath) => `   - ${pagePath}`).join('\n')}
4. evita esplorazioni ampie del repository se non strettamente necessarie
5. tratta i nuovi input come fonti da ingerire
6. VINCOLO DI ISOLAMENTO ATLETA: usa solo le nuove fonti elencate qui sotto e pagine wiki che citano esplicitamente "${feedback.athleteName}". Non usare schede, programmi, note, metriche o progressioni di altri atleti come base decisionale.

${formatScienceInstruction(sciencePaths)}

Nuove fonti grezze appena caricate:
${uploadedSourcePaths.map((sourcePath) => `- ${sourcePath}`).join('\n')}
- ${checkinSourcePath}

Contesto coach strutturato:
\`\`\`json
${coachContext}
\`\`\`

Task obbligatori:
1. Fai ingest delle nuove fonti secondo AGENTS.md.
2. Non modificare mai i file in raw/.
3. Aggiorna almeno:
   - una o piu' pagine in wiki/sources/ dedicate a ${feedback.athleteName}
   - eventuali pagine tematiche rilevanti solo se non introducono dati di altri atleti
   - wiki/index.md
   - wiki/log.md
4. Aggiorna o crea un profilo specifico atleta in wiki/athletes/${slugify(feedback.athleteName)}/profile.md solo con segnali durevoli o ricorrenti di ${feedback.athleteName}. Non aggiornare profili globali con dati di altri atleti.
5. Crea o aggiorna un memo decisionale in wiki/analyses/ che spieghi come i nuovi segnali cambiano il prossimo blocco.
6. Crea o aggiorna il programma corrente in wiki/programs/ come output operativo principale.
7. Se emergono contrasti tra fonti o tra storico e feedback attuale, registrali esplicitamente invece di appiattirli.

Task aggiuntivo per l'MVP:
Crea anche un artefatto JSON mobile-friendly in ${shareRelativePath}. Questo file e' derivato dal programma ma serve per la vista atleta.

Il file JSON deve avere questa struttura:
\`\`\`json
{
  "shareId": "${shareId}",
  "athleteName": "string",
  "coachName": "string",
  "programTitle": "string",
  "programPath": "wiki/programs/...",
  "analysisPath": "wiki/analyses/...",
  "generatedAt": "ISO-8601 string",
  "weekLabel": "string",
  "overview": "string",
  "sessions": [
    {
      "id": "day-1",
      "title": "Day 1",
      "focus": "string",
      "notes": "string",
      "exercises": [
        {
          "id": "exercise-id",
          "block": "Warm-up|Main|Accessory|Core|Conditioning|Other",
          "name": "string",
          "prescription": "string",
          "restSeconds": 90,
          "notes": "string",
          "filmPrompt": "string",
          "cameraSuggested": true
        }
      ]
    }
  ]
}
\`\`\`

Linee guida per il JSON share:
- deve rappresentare una vista operativa semplice della settimana iniziale o corrente del nuovo programma
- deve essere leggibile da atleta su mobile
- ogni esercizio deve avere un restSeconds realistico
- per gli esercizi chiave includi filmPrompt coerente con il monitoraggio
- non inserire testo placeholder

Alla fine restituisci SOLO un JSON valido che rispetta esattamente lo schema fornito dal chiamante.
`.trim()
}

function buildContextPrompt({
  athleteName,
  uploadedSourcePaths,
  contextRelativePath,
  profileRelativePath,
  latestStateRelativePath,
}) {
  return `
Stai lavorando nel repository ${repoRoot}.

Devi preparare un contesto compatto e riusabile per generazioni veloci di schede.

Atleta: ${athleteName}

Fonti caricate, tutte appartenenti SOLO a questo atleta:
${uploadedSourcePaths.map((sourcePath) => `- ${sourcePath}`).join('\n')}

Task:
1. Leggi le fonti elencate e solo eventuali pagine wiki che citano esplicitamente "${athleteName}".
2. Non usare dati di altri atleti.
3. Crea/aggiorna:
   - ${profileRelativePath}: profilo durevole atleta.
   - ${latestStateRelativePath}: stato attuale operativo, progressioni, esercizi ricorrenti, limiti, note, ultimo blocco utile.
   - ${contextRelativePath}: JSON compatto con campi liberi utili alla generazione veloce.
4. Mantieni il contesto breve ma completo: obiettivi ricorrenti, progressioni, volumi storici, segnali di recupero/dolore, esercizi da preferire/evitare, stile delle schede.
5. Non generare una nuova scheda in questa fase.

Alla fine restituisci SOLO un JSON valido secondo lo schema fornito dal chiamante.
`.trim()
}

function buildFastPrompt({
  feedback,
  checkinSourcePath,
  contextRelativePath,
  profileRelativePath,
  latestStateRelativePath,
  sciencePaths,
  shareRelativePath,
  shareId,
}) {
  const coachContext = JSON.stringify(
    {
      athleteName: feedback.athleteName,
      coachName: feedback.coachName,
      primaryGoal: feedback.primaryGoal,
      trainingDays: Number(feedback.trainingDays),
      energy: feedback.energy,
      recovery: feedback.recovery,
      adherence: feedback.adherence,
      pain: feedback.pain,
      topLimitation: feedback.topLimitation,
      feedbackNotes: feedback.feedbackNotes,
      filmingReminder: feedback.filmingReminder === 'true',
    },
    null,
    2,
  )

  return `
Stai lavorando nel repository ${repoRoot}.

Generazione veloce per ${feedback.athleteName}.

Leggi SOLO questi file:
- ${contextRelativePath}
- ${profileRelativePath}
- ${latestStateRelativePath}
- ${checkinSourcePath}
${sciencePaths.map((pagePath) => `- ${pagePath}`).join('\n')}

Non rileggere raw/sources se non strettamente indispensabile. Non usare dati di altri atleti.
Non aggiornare il wiki in questa fase: devi produrre rapidamente programma e share JSON.

${formatScienceInstruction(sciencePaths)}

Contesto coach:
\`\`\`json
${coachContext}
\`\`\`

Task:
1. Crea o aggiorna un programma operativo in wiki/programs/ per ${feedback.athleteName}.
2. Crea il JSON mobile-friendly in ${shareRelativePath}.
3. La scheda deve basarsi su contesto atleta sintetizzato, feedback coach e principi evidence-informed: progressione, specificita, gestione fatica, recupero, prossimita al cedimento, tecnica.
4. Usa una struttura chiara per coach e atleta, niente placeholder.

Il JSON share deve avere questa struttura:
\`\`\`json
{
  "shareId": "${shareId}",
  "athleteName": "string",
  "coachName": "string",
  "programTitle": "string",
  "programPath": "wiki/programs/...",
  "analysisPath": "wiki/analyses/...",
  "generatedAt": "ISO-8601 string",
  "weekLabel": "string",
  "overview": "string",
  "sessions": [
    {
      "id": "day-1",
      "title": "Day 1",
      "focus": "string",
      "notes": "string",
      "exercises": [
        {
          "id": "exercise-id",
          "block": "Warm-up|Main|Accessory|Core|Conditioning|Other",
          "name": "string",
          "prescription": "string",
          "restSeconds": 90,
          "notes": "string",
          "filmPrompt": "string",
          "cameraSuggested": true
        }
      ]
    }
  ]
}
\`\`\`

Alla fine restituisci SOLO un JSON valido secondo lo schema fornito dal chiamante.
`.trim()
}

async function runCodex(prompt, runId, schema = outputSchema) {
  const schemaPath = path.join(runsDir, `${runId}-schema.json`)
  const outputPath = path.join(runsDir, `${runId}-response.json`)
  const logPath = path.join(runsDir, `${runId}.log`)

  await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2))

  return new Promise((resolve, reject) => {
    const child = spawn(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '-m',
        codexModel,
        '-C',
        repoRoot,
        '-s',
        'danger-full-access',
        '-c',
        'approval_policy="never"',
        '--output-schema',
        schemaPath,
        '-o',
        outputPath,
        '-',
      ],
      {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)

    child.on('close', async (code) => {
      const logPayload = `STDOUT\n${stdout}\n\nSTDERR\n${stderr}\n`
      await fs.writeFile(logPath, logPayload)

      if (code !== 0) {
        reject(new Error(`codex exec failed with exit code ${code}\n${stderr || stdout}`))
        return
      }

      try {
        const rawOutput = await fs.readFile(outputPath, 'utf8')
        resolve(JSON.parse(rawOutput))
      } catch (error) {
        reject(error)
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

async function saveUploadedSources(files, athleteSlug) {
  const savedPaths = []

  for (const file of files) {
    const parsed = path.parse(file.originalname)
    const originalSlug = slugify(parsed.name) || 'source'
    const fileName = `${todayStamp()}-athlete-sheet-${athleteSlug}-${originalSlug}${parsed.ext.toLowerCase()}`
    const fullPath = await uniquePath(rawSourcesDir, fileName)

    await fs.writeFile(fullPath, file.buffer)
    savedPaths.push(path.relative(repoRoot, fullPath))
  }

  return savedPaths
}

async function saveDriveSources(driveSources, athleteSlug) {
  const savedPaths = []

  await ensureDir(driveCacheDir)

  for (const source of driveSources) {
    if (!source?.id || !source?.name) continue

    const parsed = path.parse(source.name)
    const extension = source.extension || parsed.ext || '.xlsx'
    const originalSlug = slugify(parsed.name) || 'drive-source'
    const fileName = `${todayStamp()}-drive-sheet-${athleteSlug}-${originalSlug}${extension}`
    const fullPath = await uniquePath(rawSourcesDir, fileName)
    const downloadUrl =
      source.downloadUrl ||
      (source.mimeType?.includes('spreadsheet')
        ? `https://docs.google.com/spreadsheets/d/${source.id}/export?format=xlsx`
        : `https://www.googleapis.com/drive/v3/files/${source.id}?alt=media&key=${googleApiKey}`)

    const result = await fetch(downloadUrl)
    if (!result.ok) {
      throw new Error(`Non riesco a scaricare ${source.name} da Drive (${result.status}).`)
    }

    const buffer = Buffer.from(await result.arrayBuffer())
    await fs.writeFile(fullPath, buffer)
    savedPaths.push(path.relative(repoRoot, fullPath))
  }

  return savedPaths
}

async function saveCheckinSource(feedback, uploadedSources, athleteSlug) {
  const fileName = `${todayStamp()}-athlete-checkin-${athleteSlug}-coach-app.md`
  const fullPath = await uniquePath(rawSourcesDir, fileName)
  const relativePath = path.relative(repoRoot, fullPath)
  const contents = buildCheckinSource({
    feedback,
    uploadedSources,
    checkinRelativePath: relativePath,
  })

  await fs.writeFile(fullPath, contents)
  return relativePath
}

async function getPreparedContext(athleteSlug) {
  const contextPath = path.join(athleteContextsDir, `${athleteSlug}.json`)
  if (!(await pathExists(contextPath))) return null

  try {
    const payload = JSON.parse(await fs.readFile(contextPath, 'utf8'))
    if (!payload.context_path || !payload.profile_path || !payload.latest_state_path) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function normalizeGenerateResult({ runId, codexResult, shareData, files }) {
  return {
    runId,
    summary: codexResult.summary,
    athleteName: codexResult.athlete_name,
    programTitle: codexResult.program_title,
    rawSourcePaths: codexResult.raw_source_paths,
    sourceNotePaths: codexResult.source_note_paths,
    analysisPath: codexResult.analysis_path,
    programPath: codexResult.program_path,
    shareId: codexResult.share_id,
    sharePath: codexResult.share_path,
    updatedPaths: codexResult.updated_paths,
    uploadedFiles: files.map((file) => ({
      name: file.originalname,
      sizeLabel: formatSize(file.size),
    })),
    shareData,
  }
}

function buildFallbackShareData({ shareId, feedback, codexResult }) {
  const goal = feedback.primaryGoal || 'migliorare qualita tecnica e progressione'
  const programTitle =
    codexResult.program_title || `${feedback.athleteName} - Nuova scheda`
  const programPath = codexResult.program_path || ''
  const analysisPath = codexResult.analysis_path || ''

  return {
    shareId,
    athleteName: codexResult.athlete_name || feedback.athleteName,
    coachName: feedback.coachName || 'Coach',
    programTitle,
    programPath,
    analysisPath,
    generatedAt: new Date().toISOString(),
    weekLabel: `Settimana del ${todayStamp()}`,
    overview:
      codexResult.summary ||
      `Blocco operativo orientato a ${goal}, generato dalle schede importate e dal feedback coach.`,
    sessions: [
      {
        id: 'day-1',
        title: 'Day 1',
        focus: goal,
        notes: 'Sessione tecnica principale. Mantieni margine e qualita sulle serie chiave.',
        exercises: [
          {
            id: 'warm-up-day-1',
            block: 'Warm-up',
            name: 'Preparazione scapole e polsi',
            prescription: '8-10 minuti progressivi',
            restSeconds: 45,
            notes: 'Mobilita controllata, attivazione scapolare e prime tenute leggere.',
            filmPrompt: '',
            cameraSuggested: false,
          },
          {
            id: 'main-skill-day-1',
            block: 'Main',
            name: goal,
            prescription: '4-6 serie tecniche a RPE 7-8',
            restSeconds: 150,
            notes: 'Ferma la serie quando la forma peggiora. Priorita a linea e controllo.',
            filmPrompt: 'Riprendi una serie centrale e una finale per valutare linea e compensi.',
            cameraSuggested: true,
          },
          {
            id: 'accessory-pull-day-1',
            block: 'Accessory',
            name: 'Trazioni / tirata complementare',
            prescription: '3-4 serie da 4-8 ripetizioni',
            restSeconds: 120,
            notes: 'Volume complementare senza arrivare a cedimento.',
            filmPrompt: '',
            cameraSuggested: false,
          },
        ],
      },
      {
        id: 'day-2',
        title: 'Day 2',
        focus: 'Volume controllato e basi',
        notes: 'Giornata di supporto con carico gestibile.',
        exercises: [
          {
            id: 'warm-up-day-2',
            block: 'Warm-up',
            name: 'Warm-up generale',
            prescription: '8 minuti',
            restSeconds: 45,
            notes: 'Riscaldamento progressivo senza fatica residua.',
            filmPrompt: '',
            cameraSuggested: false,
          },
          {
            id: 'main-strength-day-2',
            block: 'Main',
            name: 'Forza base upper body',
            prescription: '4 serie da 5-8 ripetizioni',
            restSeconds: 120,
            notes: 'Mantieni 1-2 ripetizioni di margine.',
            filmPrompt: '',
            cameraSuggested: false,
          },
          {
            id: 'core-day-2',
            block: 'Core',
            name: 'Core anti-estensione',
            prescription: '3 serie controllate',
            restSeconds: 75,
            notes: 'Qualita prima della durata.',
            filmPrompt: '',
            cameraSuggested: false,
          },
        ],
      },
      {
        id: 'day-3',
        title: 'Day 3',
        focus: 'Richiamo tecnico e consolidamento',
        notes: 'Richiamo piu leggero per consolidare senza accumulare troppa fatica.',
        exercises: [
          {
            id: 'warm-up-day-3',
            block: 'Warm-up',
            name: 'Attivazione specifica',
            prescription: '8-10 minuti',
            restSeconds: 45,
            notes: 'Entra gradualmente nelle progressioni.',
            filmPrompt: '',
            cameraSuggested: false,
          },
          {
            id: 'technique-day-3',
            block: 'Main',
            name: 'Progressione tecnica obiettivo',
            prescription: '5 serie brevi e pulite',
            restSeconds: 120,
            notes: 'Usa una variante che permette controllo completo.',
            filmPrompt: 'Riprendi la variante piu rappresentativa della giornata.',
            cameraSuggested: true,
          },
          {
            id: 'accessory-day-3',
            block: 'Accessory',
            name: 'Complementari mirati',
            prescription: '3 serie moderate',
            restSeconds: 90,
            notes: 'Chiudi lasciando recupero per la settimana successiva.',
            filmPrompt: '',
            cameraSuggested: false,
          },
        ],
      },
    ],
  }
}

function updateJob(jobId, patch) {
  const current = jobs.get(jobId)
  if (!current) return
  jobs.set(jobId, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

async function processContextJob({ jobId, files, athleteName }) {
  runInProgress = true
  updateJob(jobId, {
    status: 'running',
    progress: 10,
    stage: 'Salvo schede atleta',
  })

  try {
    await ensureKnowledgeBase()
    await ensureDir(rawSourcesDir)
    await ensureDir(runsDir)
    await ensureDir(athleteContextsDir)

    const athleteSlug = slugify(athleteName)
    const runId = `${todayStamp()}-${athleteSlug}-context-${nowStamp()}`
    const profileRelativePath = `wiki/athletes/${athleteSlug}/profile.md`
    const latestStateRelativePath = `wiki/athletes/${athleteSlug}/latest-state.md`
    const contextRelativePath = `data/athlete-contexts/${athleteSlug}.json`

    updateJob(jobId, {
      runId,
      progress: 32,
      stage: 'Codex sintetizza storico e progressioni',
    })

    const uploadedSourcePaths = await saveUploadedSources(files, athleteSlug)
    const prompt = buildContextPrompt({
      athleteName,
      uploadedSourcePaths,
      contextRelativePath,
      profileRelativePath,
      latestStateRelativePath,
    })

    const codexResult = await runCodex(prompt, runId, contextOutputSchema)

    const contextFullPath = path.join(repoRoot, codexResult.context_path || contextRelativePath)
    if (!(await pathExists(contextFullPath))) {
      await ensureDir(path.dirname(contextFullPath))
      await fs.writeFile(
        contextFullPath,
        JSON.stringify(
          {
            athlete_name: codexResult.athlete_name || athleteName,
            summary: codexResult.summary,
            source_paths: uploadedSourcePaths,
            profile_path: profileRelativePath,
            latest_state_path: latestStateRelativePath,
            updated_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      )
    }

    const normalizedContext = {
      ...codexResult,
      athlete_name: codexResult.athlete_name || athleteName,
      context_path: codexResult.context_path || contextRelativePath,
      profile_path: codexResult.profile_path || profileRelativePath,
      latest_state_path: codexResult.latest_state_path || latestStateRelativePath,
      source_paths: codexResult.source_paths?.length ? codexResult.source_paths : uploadedSourcePaths,
      updated_at: new Date().toISOString(),
    }

    await fs.writeFile(
      path.join(athleteContextsDir, `${athleteSlug}.json`),
      JSON.stringify(normalizedContext, null, 2),
    )

    updateJob(jobId, {
      status: 'succeeded',
      progress: 100,
      stage: 'Contesto atleta pronto',
      result: normalizedContext,
    })
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      stage: 'Preparazione contesto interrotta',
      error:
        error instanceof Error
          ? error.message
          : 'Errore non previsto durante la preparazione del contesto.',
    })
  } finally {
    runInProgress = false
  }
}

async function processGenerationJob({ jobId, files, driveSources, feedback }) {
  runInProgress = true
  updateJob(jobId, {
    status: 'running',
    progress: 10,
    stage: 'Preparo fonti e wiki atleta',
  })

  try {
    await ensureDir(rawSourcesDir)
    await ensureDir(sharesDir)
    await ensureDir(runsDir)

    const athleteSlug = slugify(feedback.athleteName)
    const runId = `${todayStamp()}-${athleteSlug}-${nowStamp()}`
    const shareId = `${todayStamp()}-${athleteSlug}-${Date.now()}`
    const shareRelativePath = path.relative(repoRoot, path.join(sharesDir, `${shareId}.json`))
    const preparedContext = await getPreparedContext(athleteSlug)
    const sciencePaths = selectSciencePaths(feedback)

    updateJob(jobId, {
      runId,
      progress: 25,
      stage: preparedContext ? 'Uso contesto atleta gia preparato' : 'Salvo schede e commenti importati',
    })

    const uploadedSourcePaths = preparedContext
      ? []
      : [
          ...(await saveUploadedSources(files, athleteSlug)),
          ...(await saveDriveSources(Array.isArray(driveSources) ? driveSources : [], athleteSlug)),
        ]

    updateJob(jobId, {
      progress: preparedContext ? 42 : 38,
      stage: 'Creo check-in coach',
    })

    const checkinSourcePath = await saveCheckinSource(
      feedback,
      uploadedSourcePaths,
      athleteSlug,
    )

    const relevantWikiPaths = preparedContext
      ? []
      : await collectRelevantWikiPaths(feedback.athleteName)

    const prompt = preparedContext
      ? buildFastPrompt({
          feedback,
          checkinSourcePath,
          contextRelativePath: preparedContext.context_path,
          profileRelativePath: preparedContext.profile_path,
          latestStateRelativePath: preparedContext.latest_state_path,
          sciencePaths,
          shareRelativePath,
          shareId,
        })
      : buildPrompt({
          feedback,
          uploadedSourcePaths,
          checkinSourcePath,
          relevantWikiPaths,
          sciencePaths,
          shareRelativePath,
          shareId,
        })

    updateJob(jobId, {
      progress: preparedContext ? 62 : 48,
      stage: preparedContext
        ? 'Codex genera da profilo sintetico'
        : 'Codex legge storico e fonti scientifiche',
    })

    const codexResult = await runCodex(prompt, runId)

    updateJob(jobId, {
      progress: 88,
      stage: 'Creo link atleta',
    })

    const shareFullPath = path.join(repoRoot, codexResult.share_path)
    if (!(await pathExists(shareFullPath))) {
      await ensureDir(path.dirname(shareFullPath))
      await fs.writeFile(
        shareFullPath,
        JSON.stringify(
          buildFallbackShareData({ shareId, feedback, codexResult }),
          null,
          2,
        ),
      )
    }
    const shareData = JSON.parse(await fs.readFile(shareFullPath, 'utf8'))

    const runRecord = {
      runId,
      feedback,
      uploadedSourcePaths,
      checkinSourcePath,
      codexResult,
    }

    await fs.writeFile(
      path.join(runsDir, `${runId}.json`),
      JSON.stringify(runRecord, null, 2),
    )

    updateJob(jobId, {
      status: 'succeeded',
      progress: 100,
      stage: 'Scheda pronta',
      result: normalizeGenerateResult({ runId, codexResult, shareData, files }),
    })
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      progress: 100,
      stage: 'Generazione interrotta',
      error:
        error instanceof Error
          ? error.message
          : 'Errore non previsto durante la generazione con Codex.',
    })
  } finally {
    runInProgress = false
  }
}

app.get('/api/status', async (_request, response) => {
  const codexPath = '/usr/bin/codex'
  response.json({
    ok: true,
    codexAvailable: await pathExists(codexPath),
    codexModel,
    repoRoot,
    rawSourcesDir,
    googleDriveConfigured: Boolean(googleApiKey),
  })
})

app.post('/api/drive/import', async (request, response) => {
  const folderId = parseDriveFolderId(request.body?.folderUrl || request.body?.folderId || '')

  if (!folderId) {
    response.status(400).json({ error: 'Incolla un link cartella Google Drive valido.' })
    return
  }

  try {
    const files = await fetchDriveChildren(folderId)
    const usableFiles = files.filter((file) => {
      const mime = file.mimeType || ''
      return (
        mime.includes('spreadsheet') ||
        mime.includes('pdf') ||
        mime.includes('document') ||
        mime.includes('officedocument') ||
        mime.includes('excel')
      )
    })

    response.json({
      folderId,
      importedAt: new Date().toISOString(),
      athletes: groupDriveFilesByAthlete(usableFiles),
      fileCount: usableFiles.length,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Errore import Google Drive.',
    })
  }
})

app.get('/api/share/:shareId', async (request, response) => {
  const shareId = slugify(request.params.shareId)
  const sharePath = path.join(sharesDir, `${shareId}.json`)

  if (!(await pathExists(sharePath))) {
    response.status(404).json({ error: 'Share non trovato.' })
    return
  }

  const payload = JSON.parse(await fs.readFile(sharePath, 'utf8'))
  response.json(payload)
})

app.put('/api/share/:shareId', async (request, response) => {
  const shareId = slugify(request.params.shareId)
  const sharePath = path.join(sharesDir, `${shareId}.json`)
  const payload = request.body

  if (!payload || typeof payload !== 'object') {
    response.status(400).json({ error: 'Payload share non valido.' })
    return
  }

  if (payload.shareId !== shareId) {
    response.status(400).json({ error: 'Share ID non coerente con la richiesta.' })
    return
  }

  if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    response.status(400).json({ error: 'La scheda deve contenere almeno una sessione.' })
    return
  }

  await ensureDir(sharesDir)
  await fs.writeFile(sharePath, JSON.stringify(payload, null, 2))
  response.json(payload)
})

app.post('/api/athlete-context', upload.array('sources', 12), async (request, response) => {
  if (runInProgress) {
    response.status(409).json({
      error: 'C’e gia un job Codex in corso. Aspetta che finisca prima di prepararne un altro.',
    })
    return
  }

  const files = request.files ?? []
  const athleteName = request.body.athleteName

  if (!athleteName?.trim()) {
    response.status(400).json({ error: 'Il nome atleta e obbligatorio.' })
    return
  }

  if (files.length === 0) {
    response.status(400).json({ error: 'Servono almeno una scheda o un riepilogo atleta.' })
    return
  }

  const athleteSlug = slugify(athleteName)
  const jobId = `${todayStamp()}-${athleteSlug}-context-${Date.now()}`
  jobs.set(jobId, {
    jobId,
    status: 'queued',
    progress: 3,
    stage: 'Preparazione contesto accodata',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  runInProgress = true

  response.status(202).json({
    jobId,
    status: 'queued',
    statusUrl: `/api/jobs/${jobId}`,
  })

  setImmediate(() => {
    processContextJob({ jobId, files, athleteName })
  })
})

app.get('/api/athlete-context/:athleteSlug', async (request, response) => {
  const athleteSlug = slugify(request.params.athleteSlug)
  const context = await getPreparedContext(athleteSlug)

  if (!context) {
    response.status(404).json({ error: 'Contesto atleta non preparato.' })
    return
  }

  response.json(context)
})

app.post('/api/generate', upload.array('sources', 6), async (request, response) => {
  if (runInProgress) {
    response.status(409).json({
      error: 'C’e gia una generazione in corso. Aspetta che finisca prima di lanciarne un’altra.',
    })
    return
  }

  const files = request.files ?? []
  const driveSources = request.body.driveSources ? JSON.parse(request.body.driveSources) : []

  const feedback = request.body

  if (!feedback.athleteName?.trim()) {
    response.status(400).json({ error: 'Il nome atleta e obbligatorio.' })
    return
  }

  const athleteSlug = slugify(feedback.athleteName)
  const jobId = `${todayStamp()}-${athleteSlug}-${Date.now()}`
  jobs.set(jobId, {
    jobId,
    status: 'queued',
    progress: 3,
    stage: 'Generazione accodata',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  runInProgress = true

  response.status(202).json({
    jobId,
    status: 'queued',
    statusUrl: `/api/jobs/${jobId}`,
  })

  setImmediate(() => {
    processGenerationJob({ jobId, files, driveSources, feedback })
  })
})

app.get('/api/jobs/:jobId', (request, response) => {
  const jobId = request.params.jobId
  const job = jobs.get(jobId)

  if (!job) {
    response.status(404).json({ error: 'Job non trovato.' })
    return
  }

  response.json(job)
})

if (await pathExists(distDir)) {
  app.use(express.static(distDir))
  app.get('/', (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, async () => {
  await ensureKnowledgeBase()
  await ensureDir(sharesDir)
  await ensureDir(runsDir)
  console.log(`coach-mvp backend listening on http://localhost:${port}`)
})
