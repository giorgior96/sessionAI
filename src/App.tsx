import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  LoaderCircle,
  Pause,
  Play,
  Sparkles,
  CheckCircle2,
  Check
} from 'lucide-react'
import { Route, Routes, useParams, Link } from 'react-router-dom'
import { mockGenerateResponse, mockShareArtifact } from './mockData'

import type {
  FeedbackFormState,
  GenerateResponse,
  GoalKey,
  ShareArtifact,
  UploadedDraft,
} from './types'

const GOAL_OPTIONS: Array<{ value: GoalKey; label: string }> = [
  { value: 'mixed', label: 'Skill + forza relativa' },
  { value: 'hspu', label: 'Priorità HSPU' },
  { value: 'front-lever', label: 'Priorità front lever' },
  { value: 'hypertrophy', label: 'Ipertrofia calisthenics' },
]

const INITIAL_FEEDBACK: FeedbackFormState = {
  athleteName: 'Luca Stucchi',
  coachName: 'Coach',
  primaryGoal: 'hspu',
  trainingDays: 3,
  energy: 'steady',
  recovery: 'steady',
  adherence: 'high',
  pain: 'none',
  topLimitation: '',
  feedbackNotes: '',
  filmingReminder: true,
}

function buildShareUrl(shareId: string) {
  return `${window.location.origin}${window.location.pathname}#/share/${shareId}`
}

function RestTimer({ 
  initialSeconds, 
  onComplete 
}: { 
  initialSeconds: number; 
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
      <div className="timer-actions" style={{ marginTop: '20px' }}>
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

function CoachPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [feedback, setFeedback] = useState(INITIAL_FEEDBACK)
  const [drafts, setDrafts] = useState<UploadedDraft[]>([])
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [message, setMessage] = useState('')

  function handleSelectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    setDrafts((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        sizeLabel: `${(file.size / 1024).toFixed(1)} KB`,
      }))
    ])
    event.target.value = ''
  }

  async function copyShareUrl() {
    if (!result) return
    const shareUrl = buildShareUrl(result.shareId)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setMessage('Link atleta copiato negli appunti!')
      setTimeout(() => setMessage(''), 3000)
    } catch {
      setMessage('Impossibile copiare.')
    }
  }

  function handleGenerate() {
    setCurrentStep(3)
    
    // MOCK DELAY AND LOGIC
    setTimeout(() => {
      setResult(mockGenerateResponse)
      setCurrentStep(4)
    }, 2000)
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">SESSION.AI COACH</p>
          <h1>Moltiplica il Tuo Metodo</h1>
          <p className="hero-copy">
            Carica le schede che hai già fatto. L'IA impara il tuo stile e ne genera di nuove, identiche alle tue, in 30 secondi.
          </p>
        </div>
      </section>

      {/* STEP 1: CARICA SCHEDE */}
      <div className={`panel wizard-step ${currentStep >= 1 ? 'is-active' : ''}`}>
        <div className="wizard-step-header" onClick={() => currentStep > 1 && setCurrentStep(1)}>
          <div className="step-circle">{currentStep > 1 ? <Check size={20} /> : '1'}</div>
          <h2>Step 1: Carico Schede Precedenti</h2>
        </div>
        
        {currentStep === 1 && (
          <div style={{ marginTop: '20px' }}>
            <label className="upload-box">
              <FileUp size={32} style={{ margin: '0 auto', color: 'var(--primary)' }} />
              <div>
                <strong>Trascina schede passate per contesto</strong>
                <p>Oppure clicca per selezionare dal tuo dispositivo.</p>
              </div>
              <input type="file" multiple onChange={handleSelectFiles} />
            </label>

            {drafts.length > 0 && drafts.map((draft) => (
              <div className="source-card" key={draft.id}>
                 <span>{draft.name}</span>
                 <span className="muted">{draft.sizeLabel}</span>
              </div>
            ))}

            <div style={{ textAlign: 'right', marginTop: '20px' }}>
              <button 
                className="primary-button" 
                onClick={() => setCurrentStep(2)}
                disabled={drafts.length === 0}
              >
                Procedi allo Step 2 <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* STEP 2: NOME E OBIETTIVI */}
      <div className={`panel wizard-step ${currentStep >= 2 ? (currentStep === 2 ? 'is-active' : 'is-completed') : ''}`}>
         <div className="wizard-step-header" onClick={() => currentStep > 2 && setCurrentStep(2)}>
          <div className="step-circle">{currentStep > 2 ? <Check size={20} /> : '2'}</div>
          <h2>Step 2: Dati Atleta & Obiettivi</h2>
        </div>

        {currentStep === 2 && (
          <div style={{ marginTop: '20px' }}>
            <div className="form-grid">
              <label>
                <span>Nome Atleta</span>
                <input value={feedback.athleteName} onChange={e => setFeedback({...feedback, athleteName: e.target.value})} />
              </label>
              <label>
                <span>Obiettivo Prioritario</span>
                <select value={feedback.primaryGoal} onChange={e => setFeedback({...feedback, primaryGoal: e.target.value as GoalKey})}>
                   {GOAL_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </label>
              <label className="full-span">
                <span>Feedback / Vincoli emersi</span>
               <textarea value={feedback.topLimitation} onChange={e => setFeedback({...feedback, topLimitation: e.target.value})} placeholder="Esempio: dolore alla spalla o stallo su planche..." />
              </label>
            </div>

            <div style={{ textAlign: 'right', marginTop: '20px' }}>
               <button className="ghost-button" onClick={() => setCurrentStep(1)} style={{ marginRight: '10px' }}>Indietro</button>
               <button className="primary-button" onClick={handleGenerate}>Genera Scheda <Sparkles size={18} /></button>
            </div>
          </div>
        )}
      </div>

      {/* STEP 3: GENERAZIONE IN CORSO */}
      <div className={`panel wizard-step ${currentStep === 3 ? 'is-active' : (currentStep > 3 ? 'is-completed' : '')}`}>
         <div className="wizard-step-header">
          <div className="step-circle">{currentStep > 3 ? <Check size={20} /> : '3'}</div>
          <h2>Step 3: Generazione Scheda</h2>
        </div>
        {currentStep === 3 && (
          <div style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
             <LoaderCircle className="spin" size={48} style={{ color: 'var(--primary)', margin: '0 auto' }} />
             <h3 style={{ marginTop: '20px' }}>Codex AI in elaborazione...</h3>
             <p className="muted" style={{ marginTop: '10px' }}>Creazione mockup basato sui dati 2026-04-08-luca-stucchi-hspu-priority-block-v1.</p>
          </div>
        )}
      </div>

       {/* STEP 4: CONDIVISIONE */}
       <div className={`panel wizard-step ${currentStep === 4 ? 'is-active' : ''}`}>
         <div className="wizard-step-header">
          <div className="step-circle">4</div>
          <h2>Step 4: Condivisione con Atleta</h2>
        </div>

        {currentStep === 4 && result && (
          <div style={{ marginTop: '20px' }}>
            <div style={{ padding: '20px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--success)', borderRadius: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
               <CheckCircle2 color="var(--success)" size={24} />
               <div>
                  <strong>Scheda generata con successo!</strong>
                  <p className="muted">{result.programTitle}</p>
               </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--glass)', padding: '20px', borderRadius: '16px' }}>
               <p className="muted">Invia questo link univoco all'atleta per fargli accedere all'app interattiva.</p>
               <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <input readOnly value={buildShareUrl(result.shareId)} style={{ flex: 1, backgroundColor: '#f1f5f9', color: 'var(--ink)' }} />
                  <button className="primary-button" onClick={copyShareUrl}><Copy size={18} /> Copia</button>
               </div>
               {message && <p style={{ color: 'var(--success)' }}>{message}</p>}
            </div>

            <div style={{ textAlign: 'center', marginTop: '30px' }}>
               <Link className="primary-button" to={`/share/${result.shareId}`} style={{ fontSize: '1.1rem', padding: '16px 32px' }}>
                  Simula Vista Atleta <ChevronRight size={20} />
               </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function AthletePage() {
  const { shareId = '' } = useParams()
  const [share, setShare] = useState<ShareArtifact | null>(null)
  
  // Interactive Flow State
  const [sessionIndex, setSessionIndex] = useState(0)
  const [exerciseIndex, setExerciseIndex] = useState(0)
  const [seriesIndex, setSeriesIndex] = useState(0)
  const [isResting, setIsResting] = useState(false)
  
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    // Mock Load based on the request
    if (shareId === mockGenerateResponse.shareId) {
      setShare(mockShareArtifact)
    } else {
      setShare(mockShareArtifact) // Fallback for mockup
    }
  }, [shareId])

  const currentSession = share?.sessions[sessionIndex]
  const currentExercise = currentSession?.exercises[exerciseIndex]

  // Parse total series from prescription (e.g. "5 x 6" -> 5)
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

  function handleCompleteSeries() {
    if (isLastSeries) {
      // Completed last series of current exercise
      if (isLastExercise) {
        // Workout Done logic can be placed here, for now return to day selection
        alert("Sessione completata, grandissimo!")
      } else {
        // Go to next exercise
        setIsResting(false) // Wait, resting after exercise? Depends. Usually rest is after a series.
        setExerciseIndex(curr => curr + 1)
        setSeriesIndex(0)
        setCameraPreviewUrl(null)
      }
    } else {
      // Go to rest timer before next series
      setIsResting(true)
    }
  }

  function handleRestComplete() {
    setIsResting(false)
    setSeriesIndex(curr => curr + 1)
  }

  function goToPreviousExercise() {
    if (!isFirstExercise) {
      setExerciseIndex(curr => curr - 1)
      setSeriesIndex(0)
      setIsResting(false)
      setCameraPreviewUrl(null)
    }
  }

  function goToNextExercise() {
     if (!isLastExercise) {
       setExerciseIndex(curr => curr + 1)
       setSeriesIndex(0)
       setIsResting(false)
       setCameraPreviewUrl(null)
     }
  }

  return (
    <main className="athlete-shell">
      <section className="athlete-hero">
        <div>
          <p className="eyebrow">{share.weekLabel}</p>
          <h1>{share.athleteName}</h1>
          <p className="hero-copy">{share.programTitle}</p>
        </div>
      </section>

      <section className="session-tabs">
        {share.sessions.map((session, index) => (
          <button
            key={session.id}
            className={`session-tab ${index === sessionIndex ? 'is-active' : ''}`}
            onClick={() => {
              setSessionIndex(index)
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

      {isResting ? (
        <RestTimer initialSeconds={currentExercise.restSeconds} onComplete={handleRestComplete} />
      ) : (
        <section className="exercise-main-card">
          <div>
            <p className="panel-kicker">{currentSession.focus} • Esercizio {exerciseIndex + 1} di {currentSession.exercises.length}</p>
            <h2 className="exercise-title">{currentExercise.name}</h2>
            <div className="exercise-prescription">{currentExercise.prescription}</div>
          </div>
          
          <p className="muted" style={{ fontSize: '1.1rem' }}>{currentExercise.notes}</p>

          <div className="series-tracker">
             <div className="series-dots">
                {Array.from({ length: seriesTotal }).map((_, i) => (
                   <div key={i} className={`series-dot ${i < seriesIndex ? 'done' : i === seriesIndex ? 'current' : ''}`} />
                ))}
             </div>
             <p className="eyebrow">Serie {seriesIndex + 1} di {seriesTotal}</p>
          </div>

          <div className="capture-panel">
            {currentExercise.cameraSuggested ? (
              <>
                <p className="panel-kicker" style={{ color: 'var(--ink)' }}>Registra Serie</p>
                {currentExercise.filmPrompt && <p className="muted" style={{ marginBottom: '15px' }}>{currentExercise.filmPrompt}</p>}
                
                <label className="camera-button">
                  <Camera size={24} /> APRI FOTOCAMERA
                  <input 
                    type="file" 
                    accept="video/*,image/*" 
                    capture="environment" 
                    className="visually-hidden"
                    onChange={(e) => {
                       const file = e.target.files?.[0]
                       if (file) {
                          setCameraPreviewUrl(URL.createObjectURL(file))
                       }
                    }}
                  />
                </label>
                {cameraPreviewUrl && (
                   <div className="camera-preview">
                     Video Catturato con Successo
                   </div>
                )}
              </>
            ) : (
              <p className="muted">Nessuna indicazione video prioritaria per questo esercizio.</p>
            )}
          </div>

          <button className="primary-button" style={{ padding: '20px', fontSize: '1.2rem', marginTop: '10px' }} onClick={handleCompleteSeries}>
             {isLastSeries ? (isLastExercise ? 'COMPLETA SESSIONE' : 'COMPLETA E VAI AL PROSSIMO ESERCIZIO') : `COMPLETA SERIE ${seriesIndex + 1}`}
          </button>
        </section>
      )}

      <nav className="sticky-nav">
        <button className="ghost-button" onClick={goToPreviousExercise} disabled={isFirstExercise}>
          <ChevronLeft size={18} /> Prec
        </button>
        <button className="ghost-button" onClick={goToNextExercise} disabled={isLastExercise}>
          Succ <ChevronRight size={18} />
        </button>
      </nav>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<CoachPage />} />
      <Route path="/share/:shareId" element={<AthletePage />} />
    </Routes>
  )
}

export default App
