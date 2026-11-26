# Bijtje

A visual, spoken day and week agenda for a person who cannot read, kept up to date by her family.

This repository holds only the app's code. All personal data lives in a private database protected by security rules; access is by personal invitation link.

Voices: Piper `nl_BE` models (rhasspy/piper-voices), run in the browser with onnxruntime-web.

Online voice (optional): Azure `nl-BE` Dena / Arnaud through a small Google Apps Script bridge (`apps-script/Code.gs`). The Azure key stays in the script's properties; the app only knows the bridge address and a shared password (`config/tts`). Without internet or bridge, Bijtje falls back to the Piper voices.
