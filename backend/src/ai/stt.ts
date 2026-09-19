import { sttConfig } from '../config.js';

export async function transcribeAudio(audio: ArrayBufferLike, mimeType = 'audio/webm') {
  const source = Buffer.from(audio);
  const bytes = new Uint8Array(source.length);
  bytes.set(source);

  if ((sttConfig.provider === 'deepgram' || !sttConfig.provider) && sttConfig.deepgramApiKey) {
    const model = sttConfig.deepgramModel;
    const url = 'https://api.deepgram.com/v1/listen?model=' + encodeURIComponent(model) + '&smart_format=true&detect_language=true';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Token ${sttConfig.deepgramApiKey}`,
        'content-type': mimeType,
      },
      body: bytes,
    });
    if (response.ok) {
      const data = await response.json();
      return {
        text: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
        provider: 'deepgram',
        model,
        fallback: false,
      };
    }
    console.error({
      event: 'stt_error',
      provider: 'deepgram',
      status: response.status,
      detail: (await response.text()).slice(0, 200),
    });
  }

  if (sttConfig.groqApiKey) {
    const form = new FormData();
    form.set('model', sttConfig.groqModel);
    form.set('file', new Blob([bytes], { type: mimeType }), 'voice.webm');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${sttConfig.groqApiKey}` },
      body: form,
    });
    if (response.ok) {
      const data = await response.json();
      return {
        text: data?.text || '',
        provider: 'groq',
        model: sttConfig.groqModel,
        fallback: false,
      };
    }
    console.error({
      event: 'stt_error',
      provider: 'groq',
      status: response.status,
      detail: (await response.text()).slice(0, 200),
    });
  }

  return { text: '', provider: 'none', model: 'none', fallback: true };
}
