import type { ShareArtifact, GenerateResponse } from './types'

export const mockShareArtifact: ShareArtifact = {
  "shareId": "2026-04-08-luca-stucchi-hspu-priority-block-v1",
  "athleteName": "Luca Stucchi",
  "coachName": "Coach",
  "programTitle": "Luca Stucchi HSPU Priority Block V1",
  "programPath": "wiki/programs/2026-04-08-luca-stucchi-hspu-priority-block-v1.md",
  "analysisPath": "wiki/analyses/2026-04-08-luca-stucchi-hspu-priority-block-rationale.md",
  "generatedAt": new Date().toISOString(),
  "weekLabel": "Settimana 1-2 : base",
  "overview": "Dare priorita' reale all'HSPU nel blocco successivo, mantenendo front lever e planche in una zona produttiva ma meno interferente.",
  "sessions": [
    {
      "id": "day-1",
      "title": "Day 1",
      "focus": "HSPU intensita' + richiamo front lever + tirata stabile",
      "notes": "Se la tecnica HSPU crolla, fermarsi prima del grind.",
      "exercises": [
        {
          "id": "day-1-warmup",
          "block": "Warm-up",
          "name": "Verticale libera a terra",
          "prescription": "1 metodo a tempo",
          "restSeconds": 60,
          "notes": "Sensazione e attivazione",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-1-hspu-back-wall",
          "block": "Main HSPU",
          "name": "HSPU schiena al muro con parallele basse",
          "prescription": "6 x 3",
          "restSeconds": 120,
          "notes": "Cerca ROM pulito e velocita' costante. Evita grind lunghi.",
          "filmPrompt": "Filma prima e ultima serie di lato.",
          "cameraSuggested": true
        },
        {
          "id": "day-1-hspu-wall-facing",
          "block": "Secondary HSPU",
          "name": "HSPU pancia al muro",
          "prescription": "4 x 2",
          "restSeconds": 90,
          "notes": "Focus linea, attivazione e ROM pulito",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-1-front-one-leg-band",
          "block": "Front Lever Light Maintenance",
          "name": "Front one leg advance loop verde",
          "prescription": "4 x 6\"",
          "restSeconds": 120,
          "notes": "Richiamo tecnico senza grind.",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-1-pull-support",
          "block": "Pull Support",
          "name": "Pin pull up",
          "prescription": "4 x 8",
          "restSeconds": 120,
          "notes": "Lavoro di volume accessorio",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-1-core",
          "block": "Core",
          "name": "Barchetta crunch inverso",
          "prescription": "4 x 45\"",
          "restSeconds": 20,
          "notes": "Mantenimento postura",
          "filmPrompt": "",
          "cameraSuggested": false
        }
      ]
    },
    {
      "id": "day-2",
      "title": "Day 2",
      "focus": "Front lever principale + chin-up pesanti + planche maintenance",
      "notes": "Il front lever non va spinto solo perche' si sente bene: resta in mantenimento produttivo.",
      "exercises": [
        {
          "id": "day-2-warmup",
          "block": "Warm-up",
          "name": "Verticale libera a coniglietto",
          "prescription": "1 metodo a tempo",
          "restSeconds": 60,
          "notes": "Sensazione e set up spinta",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-2-front-advance",
          "block": "Main Front Lever",
          "name": "Front advance",
          "prescription": "4 x 7-8\"",
          "restSeconds": 120,
          "notes": "Qualita' del controllo scapolare",
          "filmPrompt": "Filma prima e ultima serie di lato",
          "cameraSuggested": true
        },
        {
          "id": "day-2-chin-up",
          "block": "Main Pull Strength",
          "name": "Chin up +15 kg",
          "prescription": "6 x 4",
          "restSeconds": 120,
          "notes": "Potenza esplosiva concentrica",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-2-planche",
          "block": "Planche Maintenance",
          "name": "Planche lean agli anelli",
          "prescription": "3 x 8\"",
          "restSeconds": 120,
          "notes": "Semplice mantenimento della skill",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-2-core",
          "block": "Core / Compression",
          "name": "L-sit",
          "prescription": "4 x 10\"",
          "restSeconds": 30,
          "notes": "Lavoro di tenuta isometrica",
          "filmPrompt": "",
          "cameraSuggested": false
        }
      ]
    },
    {
      "id": "day-3",
      "title": "Day 3",
      "focus": "HSPU volume + dip support + tirata specifica",
      "notes": "Volume per consolidare i miglioramenti neurali di day 1.",
      "exercises": [
        {
          "id": "day-3-warmup",
          "block": "Warm-up",
          "name": "Verticale libera con parallele",
          "prescription": "1 metodo a tempo",
          "restSeconds": 60,
          "notes": "Ricerca dell'equilibrio prima di caricare HSPU",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-3-hspu-wall-facing",
          "block": "Main HSPU Volume",
          "name": "HSPU pancia al muro",
          "prescription": "6 x 3",
          "restSeconds": 120,
          "notes": "Volume tecnico. Se la linea crolla, fermati una ripetizione prima.",
          "filmPrompt": "Filma prima e ultima serie per controllare linea rispetto a sheet 3",
          "cameraSuggested": true
        },
        {
          "id": "day-3-dip",
          "block": "Push Support",
          "name": "Dip +35 kg",
          "prescription": "3 x 4",
          "restSeconds": 120,
          "notes": "Supporto forza, non priorita' del blocco",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-3-pull",
          "block": "Pull Specific Support",
          "name": "Pull up + iso 2\" scapular pull up a mezzo ROM loop verde",
          "prescription": "4 x 3",
          "restSeconds": 90,
          "notes": "Focus su stabilità della spalla",
          "filmPrompt": "",
          "cameraSuggested": false
        },
        {
          "id": "day-3-core",
          "block": "Core",
          "name": "Plank in hollow a braccia tese",
          "prescription": "5 x 45\"",
          "restSeconds": 20,
          "notes": "Hollow integrata",
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
  rawSourcePaths: ["raw/sources/2026-04-08-luca-stucchi-hspu-priority-block-v1.pdf"],
  uploadedFiles: [{ name: "2026-04-08-luca-stucchi-hspu-priority-block-v1 (1).pdf", sizeLabel: "1.2 MB" }],
  shareData: mockShareArtifact
}
