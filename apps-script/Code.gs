// Bijtje voice bridge (Google Apps Script web app).
// Turns a sentence into Flemish speech with Azure (nl-BE Dena or Arnaud) and sends it back as MP3.
// The Azure key never reaches the app: it lives only in this script's Script Properties.
//
// Script Properties (Project Settings > Script Properties):
//   AZURE_KEY     the key of your Azure Speech resource (Free F0 tier)
//   AZURE_REGION  the region of that resource, e.g. westeurope
//   SECRET        any long random word; the same word goes into Bijtje > Instellingen > Stem
//
// Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".

const VOICES = { dena: 'nl-BE-DenaNeural', arnaud: 'nl-BE-ArnaudNeural' };

function doPost(e) {
  try {
    const p = PropertiesService.getScriptProperties();
    const req = JSON.parse(e.postData.contents || '{}');
    if (!p.getProperty('SECRET') || req.key !== p.getProperty('SECRET')) return out({ ok: false, error: 'key' });
    const text = String(req.text || '').slice(0, 600).trim();
    if (!text) return out({ ok: false, error: 'empty' });
    const voice = VOICES[req.voice] || VOICES.dena;
    const speed = Math.max(0.6, Math.min(1.3, Number(req.speed) || 0.9));
    const rate = Math.round((speed - 1) * 100) + '%';

    const id = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, voice + rate + text));
    const cache = CacheService.getScriptCache();
    const hit = cache.get(id);
    if (hit) return out({ ok: true, audio: hit, cached: true });

    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ssml = `<speak version="1.0" xml:lang="nl-BE"><voice name="${voice}"><prosody rate="${rate}">${esc(text)}</prosody></voice></speak>`;
    const r = UrlFetchApp.fetch(`https://${p.getProperty('AZURE_REGION')}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'post', contentType: 'application/ssml+xml', payload: ssml, muteHttpExceptions: true,
      headers: {
        'Ocp-Apim-Subscription-Key': p.getProperty('AZURE_KEY'),
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'bijtje'
      }
    });
    if (r.getResponseCode() !== 200) return out({ ok: false, error: 'azure ' + r.getResponseCode() });
    const audio = Utilities.base64Encode(r.getContent());
    if (audio.length < 95000) cache.put(id, audio, 21600);
    return out({ ok: true, audio });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor to check the setup: it should log "ok true".
function test() {
  const r = doPost({ postData: { contents: JSON.stringify({ key: PropertiesService.getScriptProperties().getProperty('SECRET'), text: 'Hallo Deborah, dit is je nieuwe stem.' }) } });
  const o = JSON.parse(r.getContent());
  Logger.log('ok ' + o.ok + (o.error ? ' ' + o.error : ''));
}
