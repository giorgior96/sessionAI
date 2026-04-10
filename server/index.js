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
const repoRoot = path.resolve(appRoot, '..')
const distDir = path.join(appRoot, 'dist')
const rawSourcesDir = path.join(repoRoot, 'raw', 'sources')
const dataDir = path.join(appRoot, 'data')
const sharesDir = path.join(dataDir, 'shares')
const runsDir = path.join(dataDir, 'runs')
const upload = multer({ storage: multer.memoryStorage() })
const app = express()
const port = Number(process.env.PORT ?? 8787)
const codexModel = process.env.COACH_MVP_CODEX_MODEL ?? 'gpt-5.4-mini'

let runInProgress = false

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

async function collectRelevantWikiPaths(athleteName) {
  const wikiDir = path.join(repoRoot, 'wiki')
  const candidateFiles = await listFilesRecursively(wikiDir)
  const markdownFiles = candidateFiles.filter((filePath) => filePath.endsWith('.md'))
  const basePaths = [
    'wiki/index.md',
    'wiki/meta/athlete-profile.md',
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

    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 3
      }
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
Stai lavorando nel repository /home/giorgio/kownledge.

Segui rigorosamente le istruzioni in AGENTS.md. Questo repository e' un LLM wiki e il workflow da replicare e' quello reale di knowledge, non una simulazione.

Prima di fare qualsiasi scelta:
1. leggi wiki/index.md
2. leggi SOLO queste pagine del wiki come contesto iniziale, salvo che si rivelino chiaramente insufficienti:
${relevantWikiPaths.map((pagePath) => `   - ${pagePath}`).join('\n')}
3. evita esplorazioni ampie del repository se non strettamente necessarie
4. tratta i nuovi input come fonti da ingerire

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
   - una o piu' pagine in wiki/sources/
   - le pagine tematiche o skill rilevanti
   - wiki/index.md
   - wiki/log.md
4. Aggiorna wiki/meta/athlete-profile.md solo con segnali durevoli o ricorrenti.
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

async function runCodex(prompt, runId) {
  const schemaPath = path.join(runsDir, `${runId}-schema.json`)
  const outputPath = path.join(runsDir, `${runId}-response.json`)
  const logPath = path.join(runsDir, `${runId}.log`)

  await fs.writeFile(schemaPath, JSON.stringify(outputSchema, null, 2))

  return new Promise((resolve, reject) => {
    const child = spawn(
      'codex',
      [
        'exec',
        '--ephemeral',
        '-m',
        codexModel,
        '-C',
        repoRoot,
        '-s',
        'workspace-write',
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

app.get('/api/status', async (_request, response) => {
  const codexPath = '/usr/bin/codex'
  response.json({
    ok: true,
    codexAvailable: await pathExists(codexPath),
    codexModel,
    repoRoot,
    rawSourcesDir,
  })
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

app.post('/api/generate', upload.array('sources', 6), async (request, response) => {
  if (runInProgress) {
    response.status(409).json({
      error: 'C’e gia una generazione in corso. Aspetta che finisca prima di lanciarne un’altra.',
    })
    return
  }

  const files = request.files ?? []

  if (!Array.isArray(files) || files.length === 0) {
    response.status(400).json({ error: 'Carica almeno una fonte prima di generare.' })
    return
  }

  const feedback = request.body

  if (!feedback.athleteName?.trim()) {
    response.status(400).json({ error: 'Il nome atleta e obbligatorio.' })
    return
  }

  await ensureDir(rawSourcesDir)
  await ensureDir(sharesDir)
  await ensureDir(runsDir)

  const athleteSlug = slugify(feedback.athleteName)
  const runId = `${todayStamp()}-${athleteSlug}-${nowStamp()}`
  const shareId = `${todayStamp()}-${athleteSlug}-${Date.now()}`
  const shareRelativePath = path.relative(repoRoot, path.join(sharesDir, `${shareId}.json`))

  runInProgress = true

  try {
    const relevantWikiPaths = await collectRelevantWikiPaths(feedback.athleteName)
    const uploadedSourcePaths = await saveUploadedSources(files, athleteSlug)
    const checkinSourcePath = await saveCheckinSource(
      feedback,
      uploadedSourcePaths,
      athleteSlug,
    )

    const prompt = buildPrompt({
      feedback,
      uploadedSourcePaths,
      checkinSourcePath,
      relevantWikiPaths,
      shareRelativePath,
      shareId,
    })

    const codexResult = await runCodex(prompt, runId)
    const shareFullPath = path.join(repoRoot, codexResult.share_path)
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

    response.json({
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
    })
  } catch (error) {
    response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Errore non previsto durante la generazione con Codex.',
    })
  } finally {
    runInProgress = false
  }
})

if (await pathExists(distDir)) {
  app.use(express.static(distDir))
  app.get('/', (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
}

app.listen(port, async () => {
  await ensureDir(sharesDir)
  await ensureDir(runsDir)
  console.log(`coach-mvp backend listening on http://localhost:${port}`)
})
