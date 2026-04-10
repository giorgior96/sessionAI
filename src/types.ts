export type GoalKey = 'mixed' | 'hspu' | 'front-lever' | 'hypertrophy'

export interface FeedbackFormState {
  athleteName: string
  coachName: string
  primaryGoal: GoalKey
  trainingDays: number
  energy: 'high' | 'steady' | 'low'
  recovery: 'high' | 'steady' | 'low'
  adherence: 'high' | 'medium' | 'low'
  pain: 'none' | 'managed' | 'present'
  topLimitation: string
  feedbackNotes: string
  filmingReminder: boolean
}

export interface UploadedDraft {
  id: string
  file: File
  name: string
  sizeLabel: string
}

export interface ShareExercise {
  id: string
  block: string
  name: string
  prescription: string
  restSeconds: number
  notes: string
  filmPrompt: string
  cameraSuggested: boolean
}

export interface ShareSession {
  id: string
  title: string
  focus: string
  notes: string
  exercises: ShareExercise[]
}

export interface ShareArtifact {
  shareId: string
  athleteName: string
  coachName: string
  programTitle: string
  programPath: string
  analysisPath: string
  generatedAt: string
  weekLabel: string
  overview: string
  sessions: ShareSession[]
}

export interface GenerateResponse {
  runId: string
  summary: string
  athleteName: string
  programTitle: string
  rawSourcePaths: string[]
  sourceNotePaths: string[]
  analysisPath: string
  programPath: string
  shareId: string
  sharePath: string
  updatedPaths: string[]
  uploadedFiles: Array<{
    name: string
    sizeLabel: string
  }>
  shareData: ShareArtifact
}

export interface StatusResponse {
  ok: boolean
  codexAvailable: boolean
  codexModel: string
  repoRoot: string
  rawSourcesDir: string
}
