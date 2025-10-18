// server-denuncias.js — Backend DENUNCIAS (Express + Groq) para Cloud Run
// Escucha en PORT (Cloud Run usa 8080). Env: GROQ_API_KEY (obligatoria), MODEL (opcional)

import express from "express";
import cors from "cors";

const app = express();
app.use(cors()); // CORS abierto para tu front (GitHub Pages, etc.)
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* ======== PROMPT & FEW-SHOTS ======== */
const SYSTEM_DENUNCIA = `
Objetivo: redactar comparecencia/manifestación en tono policial-administrativo, técnico y objetivo.

Apertura OBLIGATORIA si constan datos:
- PRIMERA ORACIÓN: lugar (y dirección si consta), fecha y hora EXACTAMENTE como las aporte el usuario (sin inventar).
- Fórmulas: “Se persona en estas dependencias…”, “Comparece en estas dependencias…”, “El compareciente se persona al objeto de…”.

Estilo:
- Registro formal: “manifiesta”, “expone”, “indica”, “hace constar”.
- Mantener frases originales solo si ya son correctas; reformular las coloquiales/confusas.
- Gramática precisa (sin cadenas de “que”), buena puntuación; usar “sito/situado/ubicado en” (nunca “cito”).
- Sin PII ni tramitación/firmas. Extensión: 5–7 párrafos.

Salida:
- Solo HTML con <p>…</p>.
- Cada <p> comienza con “— ” (dos guiones y espacio) y la primera palabra en MAYÚSCULA.
- No iniciar párrafos con “Que,”/“que ”. Final natural.
`.trim();

const FEW_SHOTS = [
  {
    in: `Representante legal: 25/02/2015, 04:00 horas, centro comercial sito en Av. Atlántico 42 (Adeje); sustrae 5 iPhone de vitrina; hay cámaras.`,
    out: `
<p>— El representante legal comparece en estas dependencias y manifiesta que, el 25/02/2015, a las 04:00 horas, en el centro comercial sito en avenida del Atlántico número 42, en Adeje, un individuo accedió al área de tecnología y sustrajo cinco teléfonos iPhone desde una vitrina.</p>
<p>— Indica que, tras conversar brevemente con un empleado, el individuo aprovechó un momento de descuido para tomar los terminales y abandonar el establecimiento.</p>
<p>— Señala que, al percatarse de la sustracción, el dependiente regresó al expositor, constatando la falta del material y que el autor ya se había marchado del lugar.</p>
<p>— Hace constar que en el centro comercial existe sistema de videovigilancia que podría haber captado los hechos.</p>
<p>— Expone su voluntad de interponer denuncia por los hechos descritos y solicita la revisión de las grabaciones a fin de identificar al autor.</p>
`.trim()
  },
  {
    in: `Denunciante: lunes pasado ~10:30 h; avenida principal; alcance de motocicleta; conductor promete datos y no los da; daños en parachoques; posible cámara en farmacia.`,
    out: `
<p>— Se persona en estas dependencias y manifiesta que, el lunes pasado, sobre las 10:30 horas, mientras circulaba por la avenida principal, su vehículo fue alcanzado por una motocicleta al detenerse ante un semáforo.</p>
<p>— Indica que el conductor de la motocicleta se disculpó alegando distracción con el teléfono móvil, comprometiéndose a facilitar sus datos posteriormente, extremo que no llegó a producirse.</p>
<p>— Expone que, al revisar el turismo, observó daños en el parachoques trasero, consistentes en una raja y pérdida de pintura.</p>
<p>— Señala que no advirtió testigos directos, si bien en las inmediaciones existe una farmacia dotada de cámara de videovigilancia orientada a la vía pública.</p>
<p>— Hace constar su voluntad de formular denuncia por los daños causados y, en su caso, que se revisen las grabaciones para identificar al responsable.</p>
`.trim()
  }
];

/* ======== LIMPIEZA ======== */
function capLeading(t) {
  t = String(t || "").trim();
  if (!t) return t;
  if (/^[«“"']/.test(t)) return t[0] + (t[1] || "").toUpperCase() + t.slice(2);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function cleanHtmlParagraphs(html) {
  return String(html).replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => {
    let t = String(inner)
      .replace(/^[\s\u00A0\-–—]+/, "")
      .replace(/^(?:que|qu[eé])\b[\s,;:]*/i, "")
      .replace(/^(?:que\s+){1,2}/i, "")
      .trim();
    t = capLeading(t);
    if (t && !/[.!?…]$/.test(t)) t += ".";
    return `<p>— ${t}</p>`;
  });
}
function ensureMinParagraphs(html, min = 5) {
  const paras = Array.from(String(html).matchAll(/<p>— ([\s\S]*?)<\/p>/g)).map(m => m[1].trim());
  if (paras.length >= min) return html;
  const expanded = [];
  for (const p of paras) {
    const parts = p.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ"“])/).map(s => s.trim()).filter(Boolean);
    expanded.push(...(parts.length ? parts : [p]));
  }
  const out = expanded.slice(0, Math.max(min, expanded.length)).map(t => `<p>— ${t}</p>`).join("\n");
  return out || html;
}

/* ======== GROQ CLIENT ======== */
async function groqChat(apiKey, body) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Groq ${r.status}`);
  return (data?.choices?.[0]?.message?.content || "").trim();
}

/* ======== ENDPOINT ======== */
app.post("/api/police-draft", async (req, res) => {
  try {
    const API = process.env.GROQ_API_KEY;
    if (!API) return res.status(500).json({ error: "Falta GROQ_API_KEY" });

    const texto = typeof req.body?.texto === "string"
      ? req.body.texto
      : (req.body ? JSON.stringify(req.body) : "");

    const messages = [
      { role: "system", content: SYSTEM_DENUNCIA },
      ...FEW_SHOTS.flatMap(ej => ([
        { role: "user", content: ej.in },
        { role: "assistant", content: ej.out }
      ])),
      { role: "user", content: texto }
    ];

    const body = {
      model: process.env.MODEL || "llama-3.3-70b-versatile",
      temperature: 0.1,
      top_p: 0.8,
      frequency_penalty: 0.3,
      presence_penalty: 0.0,
      max_tokens: 1200,
      messages
    };

    let html = await groqChat(API, body);
    html = html.replace(/```html|```/g, "").trim();
    html = /<p[\s>]/i.test(html) ? cleanHtmlParagraphs(html) : cleanHtmlParagraphs(html.replace(/\n{2,}/g, "\n"));
    html = ensureMinParagraphs(html, 5);

    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en redacción" });
  }
});

const PORT = process.env.PORT || 8080; // Cloud Run escucha en 8080
app.listen(PORT, () => console.log(`✅ DENUNCIAS listo en :${PORT}`));
