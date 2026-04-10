import type { ShareArtifact, GenerateResponse } from './types'

export const mockShareArtifact: ShareArtifact = {
  "shareId": "2026-04-08-luca-stucchi-hspu-priority-block-v1",
  "athleteName": "Luca Stucchi",
  "coachName": "Coach",
  "programTitle": "2026-04-08-luca-stucchi-hspu-priority-block-v1",
  "programPath": "wiki/programs/2026-04-08-luca-stucchi-hspu-priority-block-v1.md",
  "analysisPath": "wiki/analyses/2026-04-08-luca-stucchi-hspu-priority-block-rationale.md",
  "generatedAt": new Date().toISOString(),
  "weekLabel": "Settimana 1",
  "overview": "Focus primario HSPU, mantenendo front lever. Filma prima e ultima serie dei due esercizi chiave.",
  "sessions": [
    {
      "id": "day-1",
      "title": "Day 1",
      "focus": "Front lever quality",
      "notes": "Apri con front lever fresco.",
      "exercises": [
        {
          "id": "day-1-front-advance",
          "block": "Main",
          "name": "Front advance",
          "prescription": "5 x 6-7 secondi",
          "restSeconds": 120,
          "notes": "Qualita' prima del volume. Stoppa la serie se perdi depressione scapolare o hollow.",
          "filmPrompt": "Filma prima e ultima serie di lato.",
          "cameraSuggested": true
        },
        {
          "id": "day-1-front-one-leg-band",
          "block": "Accessory",
          "name": "Front one leg advance",
          "prescription": "4 x 6 secondi",
          "restSeconds": 120,
          "notes": "Richiamo tecnico senza grind.",
          "filmPrompt": "",
          "cameraSuggested": false
        }
      ]
    },
    {
      "id": "day-2",
      "title": "Day 2",
      "focus": "HSPU strength",
      "notes": "Giornata di spinta verticale piu' forte.",
      "exercises": [
        {
          "id": "day-2-hspu-back-wall",
          "block": "Main",
          "name": "HSPU schiena al muro con parallele basse",
          "prescription": "6 x 3",
          "restSeconds": 120,
          "notes": "Cerca ROM pulito e velocita' costante. Evita grind lunghi.",
          "filmPrompt": "Filma prima e ultima serie di lato o a 45 gradi.",
          "cameraSuggested": true
        },
        {
          "id": "day-2-hspu-wall-facing",
          "block": "Accessory",
          "name": "HSPU pancia al muro",
          "prescription": "4 x 2",
          "restSeconds": 90,
          "notes": "Attivazione e controllo della linea.",
          "filmPrompt": "",
          "cameraSuggested": false
        }
      ]
    },
    {
      "id": "day-3",
      "title": "Day 3",
      "focus": "Front lever support + HSPU volume",
      "notes": "Terza seduta per consolidare la settimana senza alzare troppo la fatica concorrente.",
      "exercises": [
        {
          "id": "day-3-front-one-leg",
          "block": "Main",
          "name": "Front one leg advance",
          "prescription": "4 x 6 secondi",
          "restSeconds": 120,
          "notes": "Seconda esposizione front lever.",
          "filmPrompt": "Filma almeno l'ultima serie per controllare linea e controllo scapolare.",
          "cameraSuggested": true
        },
        {
          "id": "day-3-hspu-wall-facing",
          "block": "Main",
          "name": "HSPU pancia al muro",
          "prescription": "5 x 3",
          "restSeconds": 120,
          "notes": "Volume tecnico. Se la linea crolla, fermati una ripetizione prima.",
          "filmPrompt": "",
          "cameraSuggested": false
        }
      ]
    }
  ]
}

export const mockGenerateResponse: GenerateResponse = {
  runId: "mock-run-id-123",
  athleteName: "Luca Stucchi",
  shareId: "2026-04-08-luca-stucchi-hspu-priority-block-v1",
  sharePath: "data/shares/2026-04-08-luca-stucchi-hspu-priority-block-v1.json",
  programTitle: "Luca Stucchi HSPU Priority Block V1",
  summary: "Programmazione aggiornata con successo per HSPU Priority Block. Focus su volume verticale e mantenimento leve orizzontali.",
  updatedPaths: ["wiki/index.md", "wiki/log.md", "wiki/meta/athlete-profile.md"],
  programPath: "wiki/programs/2026-04-08-luca-stucchi-hspu-priority-block-v1.md",
  analysisPath: "wiki/analyses/2026-04-08-luca-stucchi-hspu-priority-block-rationale.md",
  sourceNotePaths: ["wiki/sources/2026-04-08-luca-stucchi-hspu-priority-block-v1.md"],
  rawSourcePaths: ["raw/sources/2026-04-08-luca-stucchi-scheda-precedente.xlsx"],
  uploadedFiles: [{ name: "2026-04-08-luca-stucchi-scheda-precedente.xlsx", sizeLabel: "45 KB" }],
  shareData: mockShareArtifact
}
