import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { parse } from "csv-parse/sync";
import XLSX from "xlsx";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ ERROR: Falta OPENAI_API_KEY en .env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "g5_strategyai_landing.html"));
});

app.post("/api", async (req, res) => {
  try {
    const { mensaje, empresa, framework } = req.body;
    if (!mensaje) return res.status(400).json({ error: "Mensaje requerido" });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un consultor estratégico senior. Responde en español con análisis profundo, ejecutivo y accionable. Usa bullets y secciones claras." },
        { role: "user", content: `Empresa: ${empresa || "No especificada"} | Framework: ${framework || "General"}\n\n${mensaje}` }
      ]
    });
    res.json({ respuesta: response.choices[0].message.content });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Error con el servicio de IA" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ANÁLISIS DE CSV - DEFINITIVO (+ PREDICCIÓN)
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/analyze-csv", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });

    console.log("\n🚀 PROCESANDO ARCHIVO:", req.file.originalname);

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isExcel = ext === ".xlsx" || ext === ".xls" ||
                    req.file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    let rows;
    if (isExcel) {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      console.log("📊 Formato Excel detectado");
    } else {
      const raw = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");
      let delimiter = ";";
      let parsed;
      try {
        parsed = parse(raw, { columns: true, skip_empty_lines: true, trim: true, delimiter: ";" });
        if (parsed.length === 0 || Object.keys(parsed[0]).length < 2) throw new Error("probar con coma");
        console.log("✅ Delimitador detectado: punto y coma (;)");
      } catch (e) {
        delimiter = ",";
        parsed = parse(raw, { columns: true, skip_empty_lines: true, trim: true, delimiter: "," });
        console.log("✅ Delimitador detectado: coma (,)");
      }
      rows = parsed;
    }

    if (!rows || rows.length === 0) return res.status(400).json({ error: "Archivo vacío o sin datos" });

    console.log("🔍 Columnas encontradas:", Object.keys(rows[0]));
    console.log("🔍 Primera fila (raw):", rows[0]);

    // ============================================================
    // 1. Limpiar filas de totales
    // ============================================================
    const columnas = Object.keys(rows[0]);
    const posiblesNumericas = columnas.filter(c => {
      const primerValor = rows[0][c];
      return !isNaN(parseFloat(String(primerValor).replace(/\./g, "").replace(",", ".")));
    });
    const esFilaTotal = (fila) => {
      for (const col of columnas) {
        if (!posiblesNumericas.includes(col)) {
          const val = String(fila[col] || "").toLowerCase();
          if (val.includes("total") || val === "suma" || val === "totales") return true;
        }
      }
      for (const col of posiblesNumericas) {
        const allVals = rows.map(r => parseNum(r[col])).filter(n => !isNaN(n));
        if (allVals.length === 0) continue;
        const sorted = [...allVals].sort((a,b) => a-b);
        const median = sorted[Math.floor(sorted.length/2)];
        const current = parseNum(fila[col]);
        if (!isNaN(current) && median > 0 && current > median * 8) return true;
      }
      return false;
    };
    const originalCount = rows.length;
    rows = rows.filter(fila => !esFilaTotal(fila));
    console.log(`📉 Filas eliminadas por totales: ${originalCount - rows.length} (quedan ${rows.length})`);

    // ============================================================
    // 2. Parsear números robusto
    // ============================================================
    function parseNum(v) {
      if (v === null || v === undefined || v === "") return NaN;
      let s = String(v).trim();
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
        s = s.replace(/\./g, "").replace(",", ".");
      }
      else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
        s = s.replace(/,/g, "");
      }
      else if (/^\d+,\d+$/.test(s)) {
        s = s.replace(",", ".");
      }
      s = s.replace(/[$S/.€£¥ ]/g, "").replace(/%$/, "");
      const num = parseFloat(s);
      return isNaN(num) ? NaN : num;
    }

    // ============================================================
    // 3. Identificar columnas clave
    // ============================================================
    const colVentas = Object.keys(rows[0]).find(c => /venta|ingres|monto|total|revenue|sales|factura/i.test(c));
    const colMorosidad = Object.keys(rows[0]).find(c => /morosidad|tasa|porcentaje|ratio/i.test(c));
    const colClientes = Object.keys(rows[0]).find(c => /cliente|usuario|cantidad|pedido/i.test(c));
    const colFecha = Object.keys(rows[0]).find(c => /fecha|date/i.test(c));
    const colRegion = Object.keys(rows[0]).find(c => /region|ciudad|zona|departamento|area/i.test(c));
    const colSegmento = Object.keys(rows[0]).find(c => /segmento|tipo|canal|cliente/i.test(c));

    if (!colVentas) {
      return res.status(400).json({ error: "No se encontró una columna de ventas. Las columnas son: " + Object.keys(rows[0]).join(", ") });
    }

    // ============================================================
    // 4. Sumar ventas, clientes, morosidad
    // ============================================================
    let sumaVentas = 0, valoresVentas = 0;
    let sumaClientes = 0, valoresClientes = 0;
    let sumaMorosidad = 0, valoresMorosidad = 0;

    for (const row of rows) {
      const venta = parseNum(row[colVentas]);
      if (!isNaN(venta)) { sumaVentas += venta; valoresVentas++; }
      if (colClientes) {
        const cliente = parseNum(row[colClientes]);
        if (!isNaN(cliente)) { sumaClientes += cliente; valoresClientes++; }
      }
      if (colMorosidad) {
        const mora = parseNum(row[colMorosidad]);
        if (!isNaN(mora)) { sumaMorosidad += mora; valoresMorosidad++; }
      }
    }

    console.log(`💰 SUMA DE ${colVentas}: ${sumaVentas.toFixed(2)} (${valoresVentas} válidos de ${rows.length} filas)`);
    if (colClientes) console.log(`👥 SUMA DE ${colClientes}: ${sumaClientes} (${valoresClientes} valores)`);
    if (colMorosidad) console.log(`📊 MOROSIDAD PROMEDIO: ${(sumaMorosidad/valoresMorosidad).toFixed(4)} (${valoresMorosidad} valores)`);

    // ============================================================
    // 5. Construir KPIs
    // ============================================================
    const kpis = [
      { nombre: "Ventas totales", valor: formatNumber(sumaVentas), valorRaw: sumaVentas, impacto: "alto", tendencia: "estable", crecimiento: null }
    ];
    if (colMorosidad && valoresMorosidad > 0) {
      const moraProm = sumaMorosidad / valoresMorosidad;
      const moraPorc = moraProm <= 1 ? moraProm * 100 : moraProm;
      kpis.push({ nombre: "Morosidad promedio", valor: `${moraPorc.toFixed(2)}%`, valorRaw: moraProm, impacto: "medio", tendencia: "estable", crecimiento: null });
    }
    if (colClientes && valoresClientes > 0) {
      kpis.push({ nombre: "Clientes totales", valor: formatNumber(sumaClientes), valorRaw: sumaClientes, impacto: "alto", tendencia: "estable", crecimiento: null });
    }
    kpis.push({ nombre: "Registros analizados", valor: rows.length.toLocaleString("es-PE"), valorRaw: rows.length, impacto: "bajo", tendencia: "estable", crecimiento: null });

    // ============================================================
    // 6. Generar gráficos
    // ============================================================
    const charts = [];

    if (colRegion) {
      const agg = {};
      for (const row of rows) {
        const venta = parseNum(row[colVentas]);
        if (!isNaN(venta)) {
          const key = row[colRegion] || "Sin región";
          agg[key] = (agg[key] || 0) + venta;
        }
      }
      const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 10);
      if (sorted.length) {
        charts.push({
          id: "chart-region",
          tipo: "bar",
          titulo: `Ventas por ${colRegion}`,
          descripcion: "Distribución geográfica",
          labels: sorted.map(e => e[0]),
          data: sorted.map(e => +e[1].toFixed(2))
        });
      }
    }

    if (colFecha) {
      const agg = {};
      for (const row of rows) {
        const venta = parseNum(row[colVentas]);
        if (!isNaN(venta)) {
          let fecha = row[colFecha];
          if (fecha && typeof fecha === "string") {
            const partes = fecha.split("/");
            if (partes.length === 3) fecha = `${partes[1]}/${partes[2]}`;
          }
          agg[fecha] = (agg[fecha] || 0) + venta;
        }
      }
      const sorted = Object.entries(agg).sort((a,b) => a[0].localeCompare(b[0])).slice(0, 20);
      if (sorted.length >= 2) {
        charts.push({
          id: "chart-time",
          tipo: "line",
          titulo: `Evolución de ventas`,
          descripcion: "Serie temporal",
          labels: sorted.map(e => e[0]),
          data: sorted.map(e => +e[1].toFixed(2))
        });
      }
    }

    if (colSegmento) {
      const agg = {};
      for (const row of rows) {
        const venta = parseNum(row[colVentas]);
        if (!isNaN(venta)) {
          const key = row[colSegmento] || "Sin segmento";
          agg[key] = (agg[key] || 0) + venta;
        }
      }
      const sorted = Object.entries(agg).sort((a,b) => b[1]-a[1]).slice(0, 7);
      const rest = Object.entries(agg).slice(7).reduce((s, e) => s + e[1], 0);
      if (rest > 0) sorted.push(["Otros", rest]);
      if (sorted.length >= 2) {
        charts.push({
          id: "chart-segment",
          tipo: "doughnut",
          titulo: `Ventas por ${colSegmento}`,
          descripcion: "Participación por segmento",
          labels: sorted.map(e => e[0]),
          data: sorted.map(e => +e[1].toFixed(2))
        });
      }
    }

    if (charts.length === 0) {
      charts.push({
        id: "chart-sample",
        tipo: "bar",
        titulo: "Ventas (primeras 10 filas)",
        descripcion: "Muestra de datos",
        labels: rows.slice(0,10).map((_,i) => `Fila ${i+1}`),
        data: rows.slice(0,10).map(r => parseNum(r[colVentas])).filter(n => !isNaN(n))
      });
    }

    // ============================================================
    // 6b. PREDICCIÓN DE VENTAS (tendencia lineal)
    // ============================================================
    let prediccion = null;
    if (colFecha && rows.length >= 3) {
      const ventasPorMes = {};
      for (const row of rows) {
        const venta = parseNum(row[colVentas]);
        if (!isNaN(venta)) {
          let fecha = row[colFecha];
          if (fecha && typeof fecha === "string") {
            const partes = fecha.split("/");
            if (partes.length === 3) {
              const mes = partes[1];
              const anio = partes[2];
              const key = `${anio}-${mes}`;
              ventasPorMes[key] = (ventasPorMes[key] || 0) + venta;
            }
          }
        }
      }
      const mesesOrdenados = Object.keys(ventasPorMes).sort();
      if (mesesOrdenados.length >= 3) {
        const valores = mesesOrdenados.map(m => ventasPorMes[m]);
        const n = valores.length;
        const indices = [...Array(n).keys()];
        const sumX = indices.reduce((a,b)=>a+b,0);
        const sumY = valores.reduce((a,b)=>a+b,0);
        const sumXY = indices.reduce((a,i)=>a + i*valores[i],0);
        const sumX2 = indices.reduce((a,i)=>a + i*i,0);
        const pendiente = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
        const ultimoValor = valores[valores.length-1];
        const proxMes = ultimoValor + pendiente;
        const lastMes = mesesOrdenados[mesesOrdenados.length - 1];
        const [lastAnio, lastMesNum] = lastMes.split('-').map(Number);
        const nextMesNum = lastMesNum === 12 ? 1 : lastMesNum + 1;
        const nextAnio = lastMesNum === 12 ? lastAnio + 1 : lastAnio;
        const nextLabel = `${String(nextMesNum).padStart(2,'0')}/${nextAnio}`;
        prediccion = {
          mes_siguiente: proxMes > 0 ? formatNumber(proxMes) : "estable",
          mes_siguiente_raw: proxMes > 0 ? Math.round(proxMes) : null,
          label: nextLabel,
          tendencia: pendiente > 0 ? "crecimiento" : (pendiente < 0 ? "decrecimiento" : "estable")
        };
        console.log("📈 Predicción calculada:", prediccion);
      }
    }

    // ============================================================
    // 7. Llamada a IA para análisis estratégico completo (incluye predicción)
    // ============================================================
    let aiData = { resumen_ejecutivo: "", insights: [], oportunidades: [], estrategia: [], riesgos: [] };
    try {
      const prompt = `Analiza este dataset empresarial de ${rows.length} filas.

📊 KPIs clave:
- Ventas totales: ${formatNumber(sumaVentas)}
${colMorosidad ? `- Morosidad promedio: ${(sumaMorosidad/valoresMorosidad*100).toFixed(2)}%` : ""}
${colClientes ? `- Clientes totales: ${formatNumber(sumaClientes)}` : ""}
${colRegion ? `- Columnas: Región (${colRegion}), Segmento (${colSegmento || 'N/A'})` : ""}
${prediccion ? `- Predicción: Próximo mes se estiman ventas de ${prediccion.mes_siguiente} (tendencia: ${prediccion.tendencia})` : ""}

Genera un análisis estratégico completo con estas 5 secciones OBLIGATORIAS (cada array debe tener al menos 2 elementos):

1. **resumen_ejecutivo**: string de 2-3 oraciones con el hallazgo principal.
2. **insights**: array de 3-5 objetos con { titulo, descripcion, urgencia: "critico|importante|informativo" }
3. **oportunidades**: array de 2-3 objetos con { titulo, descripcion, potencial: "alto|medio|bajo" }
4. **estrategia**: array de 3-4 objetos con { accion, plazo: "inmediato|30dias|90dias|6meses", impacto_esperado, prioridad: 1..5 }
5. **riesgos**: array de 2-3 objetos con { riesgo, probabilidad: "alta|media|baja", mitigacion }

Responde ÚNICAMENTE con un JSON válido.`;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres un consultor estratégico senior. Tus respuestas son prácticas, basadas en datos y accionables. Siempre devuelves todas las secciones requeridas." },
          { role: "user", content: prompt }
        ],
        max_tokens: 1300
      });
      
      aiData = JSON.parse(aiResponse.choices[0].message.content);
      
      // Fallbacks
      aiData.insights = aiData.insights || [];
      aiData.oportunidades = aiData.oportunidades || [];
      aiData.estrategia = aiData.estrategia || [];
      aiData.riesgos = aiData.riesgos || [];
      
      if (aiData.oportunidades.length === 0) {
        aiData.oportunidades = [
          { titulo: "Optimización de cobranza", descripcion: "Implementar recordatorios automáticos para reducir morosidad", potencial: "alto" }
        ];
      }
      if (aiData.estrategia.length === 0) {
        aiData.estrategia = [
          { accion: "Revisar datos para plan detallado", plazo: "30dias", impacto_esperado: "Mejorar toma de decisiones", prioridad: 1 }
        ];
      }
      if (aiData.riesgos.length === 0) {
        aiData.riesgos = [
          { riesgo: "Falta de análisis más profundo", probabilidad: "media", mitigacion: "Recolectar más datos históricos" }
        ];
      }
      
    } catch (err) { 
      console.error("Error IA:", err.message);
      aiData = {
        resumen_ejecutivo: `Se analizaron ${rows.length} registros. Ventas totales: ${formatNumber(sumaVentas)}.`,
        insights: [{ titulo: "Revisar datos manualmente", descripcion: "La IA no pudo generar insights automáticos. Intenta de nuevo.", urgencia: "informativo" }],
        oportunidades: [{ titulo: "Explorar segmentos clave", descripcion: "Identifica qué región o segmento tiene mayor potencial", potencial: "medio" }],
        estrategia: [{ accion: "Realizar análisis complementario", plazo: "30dias", impacto_esperado: "Mejores decisiones", prioridad: 1 }],
        riesgos: [{ riesgo: "Dependencia de automatización", probabilidad: "baja", mitigacion: "Validar con experto humano" }]
      };
    }

    // ============================================================
    // 8. Respuesta final
    // ============================================================
    const cleanRows = rows.slice(0, 2000);
    res.json({
      kpis,
      charts,
      prediccion,
      quality: { advertencias: [], registros_totales: rows.length, columnas: Object.keys(rows[0]).length },
      cleanRows,
      resumen_ejecutivo: aiData.resumen_ejecutivo || `Ventas totales de ${formatNumber(sumaVentas)}.`,
      insights: aiData.insights || [],
      oportunidades: aiData.oportunidades || [],
      estrategia: aiData.estrategia || [],
      riesgos: aiData.riesgos || []
    });

  } catch (err) {
    console.error("❌ Error en /api/analyze-csv:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  SIMULACIÓN WHAT-IF
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/whatif", async (req, res) => {
  try {
    const { pregunta, contexto = {} } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Pregunta requerida" });

    const ctxStr = [
      contexto.ventas_totales ? `Ventas totales: ${contexto.ventas_totales}` : '',
      contexto.morosidad      ? `Morosidad promedio: ${contexto.morosidad}` : '',
      contexto.clientes       ? `Clientes totales: ${contexto.clientes}` : '',
      contexto.registros      ? `Registros analizados: ${contexto.registros}` : '',
      contexto.prediccion     ? `Predicción próximo mes: ${contexto.prediccion.mes_siguiente} (${contexto.prediccion.tendencia})` : ''
    ].filter(Boolean).join('\n');

    const prompt = `Eres un consultor estratégico senior con experiencia en simulaciones financieras.

Datos actuales del negocio:
${ctxStr || '(Sin datos de contexto disponibles)'}

El usuario pregunta: "${pregunta}"

Responde con un análisis what-if conciso y accionable. Devuelve ÚNICAMENTE este JSON válido:
{
  "impacto_estimado": "descripción breve del impacto en ventas/ingresos (1-2 oraciones con cifras estimadas si es posible)",
  "impacto_tipo": "positivo|negativo|neutro",
  "riesgo_nivel": "alto|medio|bajo",
  "riesgo_descripcion": "descripción del riesgo principal (1 oración)",
  "puntos_clave": ["punto 1", "punto 2", "punto 3"]
}`;

    const aiRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Eres un consultor estratégico experto en simulaciones what-if. Devuelves análisis concisos, realistas y basados en datos. Solo JSON válido." },
        { role: "user", content: prompt }
      ],
      max_tokens: 400
    });

    const result = JSON.parse(aiRes.choices[0].message.content);
    res.json(result);
  } catch (err) {
    console.error("❌ Error en /api/whatif:", err.message);
    res.status(500).json({ error: "Error al calcular simulación" });
  }
});

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("es-PE", { maximumFractionDigits: 2 });
}

const PORT = process.env.PORT || 5500;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en http://localhost:${PORT}`));