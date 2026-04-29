require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch'); // 👈 importante si usas Node <18

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/chat', async (req, res) => {
  try {
    const { system, messages } = req.body;

    const userText = messages?.[0]?.content || '';
    const fullPrompt = system ? system + '\n\n' + userText : userText;

    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_KEY) {
      return res.status(500).json({ error: "API KEY no definida" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: fullPrompt }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7
        }
      })
    });

    const data = await response.json();

    console.log("Respuesta Gemini:", data); // 👈 debug útil

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.error?.message ||
      'Sin respuesta.';

    res.json({
      content: [{ type: 'text', text }]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(5500, () => {
  console.log('');
  console.log('✅ Servidor corriendo');
  console.log('🌐 http://127.0.0.1:5500/g5_strategyai_landing.html');
  console.log('');
});