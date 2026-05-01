import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

// Servir landing en la raíz
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "g5_strategyai_landing.html"));
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/api", async (req, res) => {
  try {
    const { mensaje, empresa, framework } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Eres un consultor estratégico. Empresa: ${empresa}, Framework: ${framework}. Pregunta: ${mensaje}`
        }
      ]
    });

    res.json({
      respuesta: response.choices[0].message.content
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Error con IA");
  }
});

app.listen(5500, () => {
  console.log("Servidor corriendo en http://localhost:5500");
});