import { sttConfig } from '../config.js';

export async function transcribeAudio(audio: ArrayBuffer, mimeType = 'audio/webm') {
  if ((sttConfig.provider === 'deepgram' || !sttConfig.provider) && sttConfig.deepgramApiKey) {
    const model = sttConfig.deepgramModel;
    const response = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true`, {
      method: 'POST',
      headers: {
        authorization: `Token ${sttConfig.deepgramApiKey}`,
        'content-type': mimeType,
      },
      body: Buffer.from(audio),
    });
    if (response.ok) {
      const data = await response.json();
      return { text: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '', provider: 'deepgram', model, fallback: false };
    }
    console.error({ event: 'stt_error', provider: 'deepgram', status: response.status, detail: (await response.text()).slice(0, 200) });
  }

  if (sttConfig.groqApiKey) {
    const form = new FormData();
    form.set('model', sttConfig.groqModel);
    form.set('file', new Blob([audio], { type: mimeType }), 'voice.webm');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${sttConfig.groqApiKey}` },
      body: form,
    });
    if (response.ok) {
      const data = await response.json();
      return { text: data?.text || '', provider: 'groq', model: sttConfig.groqModel, fallback: false };
    }
    console.error({ event: 'stt_error', provider: 'groq', status: response.status, detail: (await response.text()).slice(0, 200) });
  }

  return { text: '', provider: 'mock', model: 'none', fallback: true };
}
