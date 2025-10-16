import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';

const app = express();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

// CORS abierto (si quieres, luego limitas al dominio de tu Pages)
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', (req,res)=>res.sendStatus(200));

// Body parser
app.use(express.json({ limit: '2mb' }));

// Prompt del sistema (resumen según lo acordado)
const SYSTEM_PROMPT = `
TAREA:
Redactar en tono policial-administrativo a partir del texto/transcripción recibido.
Exponer con claridad y orden lo manifestado, sin inventar ni añadir conclusiones. Terminar de forma natural.

DIRECTRICES:
1) No incluir datos personales (nombres, documentos, domicilios, teléfonos, filiaciones).
2) No incluir encabezados, firmas ni tramitaciones.
3) Sin frases de cierre; terminar de forma natural.
4) Inicio y conectores libres y formales (p.ej., “Comparece…”, “Se persona…”).
5) SALIDA: HTML con <p>. Cada <p> debe empezar por “— ” (dos guiones y espacio).
`;

// Fallback sencillo a párrafos con “— ”
function normalizeToParagraphHTML(text) {
  const lines = String(text || '')
    .replace(/\r/g,'')
    .split(/\n{2,}|\.\s{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!lines.length) return '<p>— </p>';
  return lines.map(s => `<p>— ${s.replace(/^Que\s+/i,'')}</p>`).join('\n');
}

async function callGrok(userPayload) {
  const url = process.env.GROK_API_URL;
  const key = process.env.GROK_API_KEY;
  if (!url || !key) {
    const bruto = typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload);
    return normalizeToParagraphHTML(bruto);
  }
  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: typeof userPayload === 'string' ? userPayload : JSON.stringify(userPayload) }
    ],
    temperature: 0.3
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`Grok HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const html = data?.choices?.[0]?.message?.content?.trim();
  return html && /<p[\s>]/i.test(html) ? html : normalizeToParagraphHTML(html || String(data || ''));
}

// Rutas
app.post('/api/police-draft', async (req, res) => {
  try {
    const payload = req.body || {};
    const html = await callGrok(payload);
    res.json({ html });
  } catch (e) { res.status(500).json({ error: String(e.message||e) }); }
});

app.post('/api/whisper', upload.single('file'), async (req, res) => {
  // Opcional: si no usas transcripción ahora, devuelve vacío
  return res.json({ text: '' });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OK http://localhost:${PORT}`));
